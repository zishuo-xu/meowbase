import {
  allowsAutoApprove,
  buildSystemPrompt,
  classifyDiffRisk,
  displayName,
  formatA2AHandoffPrompt,
  gateReviewVerdict,
  matchSkills,
  parseReviewVerdict,
  selectReviewer,
  toEvidenceScopeThread,
} from '@meowbase/shared';
import type {
  AgentId,
  EvidenceEntry,
  MentionCatalog,
  Skill,
  TeamMember,
} from '@meowbase/shared';
import { gitAddAll, gitDiffHead, resolveDiffMarker } from '../../services/git.js';
import { overlayProfile, refreshSopBoard } from './context.js';
import { randomUUID } from 'node:crypto';
import { landApprovedCard } from './land-approval.js';
import { clip, turnLog } from '../../services/turn-log.js';
import { runAgentTurn } from './agent-hop.js';
import { MAX_REVIEW_FIX_ROUNDS, type ThreadRuntime, type TurnContext, type WriteQueue } from './types.js';

const RISK_LABEL = { safety: '安全面', contract: '契约面' } as const;

export function reviewPrompt(diff: { stat: string; text: string }, workdir: string): string {
  return (
    `请作为审查官审查以下代码改动。当前工作目录是 ${workdir}。` +
    '只审查该目录中本次产生的改动,不要上溯或审查平台 packages/。' +
    '输出:问题列表→建议→结论(通过/需修改)。结论必须单独写明「通过」或「需修改」。' +
    '没看到或没亲手跑出命令+结果,不能写通过。' +
    '需修改时列出要点,不要问人,不要 @ 其他人(平台会按结论自动打回写手再审)。\n\n' +
    `${diff.stat}\n\n${diff.text}`
  );
}

export async function runReviewFixThenCard(input: {
  context: TurnContext;
  thread: ThreadRuntime;
  threadId: string;
  writerAgentId: AgentId;
  chainLastAgent?: AgentId;
  chainLastContent?: string;
  initialDiff: { text: string; stat: string; files?: string[] };
  writeQueue: WriteQueue;
  catalog: MentionCatalog;
  team: readonly TeamMember[];
  refs: EvidenceEntry[];
}): Promise<void> {
  const { context, thread, threadId, writerAgentId, writeQueue, catalog, team, refs } = input;
  const available = context.registry.list();
  const chainReviewer =
    input.chainLastAgent &&
    input.chainLastAgent !== writerAgentId &&
    available.includes(input.chainLastAgent)
      ? input.chainLastAgent
      : undefined;
  const risk = classifyDiffRisk(input.initialDiff.files ?? []);
  const reviewerAgentId = chainReviewer ?? selectReviewer(writerAgentId, available, team, risk);
  turnLog('review start', {
    thread: threadId,
    writer: writerAgentId,
    reviewer: reviewerAgentId,
    reused: Boolean(chainReviewer),
    risk,
  });
  let latestDiff = input.initialDiff;
  let reviewComment = '(无可用审查 agent)';

  if (reviewerAgentId && reviewerAgentId !== writerAgentId && context.registry.get(reviewerAgentId)) {
    const reviewSkill = (await context.stores.skills.list()).find((s: Skill) => s.id === 'review');
    const reviewerStored = (await context.stores.profiles.get(reviewerAgentId)) ?? undefined;
    const reviewerSpec = context.agents?.find((a) => a.id === reviewerAgentId);
    const sop = await refreshSopBoard(context, threadId, team);
    const reviewerPrompt = buildSystemPrompt({
      profile: overlayProfile(reviewerStored, reviewerSpec),
      team,
      skills: reviewSkill ? [reviewSkill] : [],
      evidenceRefs: [],
      workdir: thread.workdir,
      repo: thread.repo,
      sop,
    });

    const runReview = async (): Promise<string> => {
      await writeQueue(() =>
        context.stores.messages.append({
          threadId,
          role: 'system',
          content: `🤝 审查:${displayName(writerAgentId, catalog)} → ${displayName(reviewerAgentId, catalog)}${risk === 'default' ? '' : `·${RISK_LABEL[risk]}`}`,
          status: 'completed',
          systemKind: 'notice',
          systemMeta: { risk },
        }),
      );
      const reviewHop = await runAgentTurn(
        context,
        thread,
        reviewerAgentId,
        reviewPrompt(latestDiff, thread.workdir),
        reviewerPrompt,
        writeQueue,
        randomUUID(),
        reviewSkill ? [reviewSkill.id] : undefined,
      );
      return reviewHop.content || '(审查无输出)';
    };

    reviewComment =
      chainReviewer && input.chainLastContent
        ? input.chainLastContent
        : await runReview();

    for (let fix = 0; fix < MAX_REVIEW_FIX_ROUNDS; fix++) {
      if (parseReviewVerdict(reviewComment) !== 'revise') break;
      turnLog('review revise', { thread: threadId, round: fix + 1, writer: writerAgentId });
      await writeQueue(() =>
        context.stores.messages.append({
          threadId,
          role: 'system',
          content: `🤝 打回:${displayName(reviewerAgentId, catalog)} → ${displayName(writerAgentId, catalog)}`,
          status: 'completed',
          systemKind: 'relay',
          systemMeta: { from: reviewerAgentId, to: writerAgentId },
        }),
      );
      const writerStored = thread.sessions[writerAgentId]
        ? undefined
        : ((await context.stores.profiles.get(writerAgentId)) ?? undefined);
      const writerSpec = context.agents?.find((a) => a.id === writerAgentId);
      const writerProfile = overlayProfile(writerStored, writerSpec);
      const fixSkills = await matchSkills(reviewComment, await context.stores.skills.list());
      const fixPrompt = formatA2AHandoffPrompt(
        displayName(reviewerAgentId, catalog),
        reviewerAgentId,
        reviewComment,
        '审查结论为需修改。请只修复上述问题,改完不要问人,不要再 @ 审查官(平台会自动再审一轮)。',
        { workdir: thread.workdir },
      );
      await runAgentTurn(
        context,
        thread,
        writerAgentId,
        fixPrompt,
        buildSystemPrompt({
          profile: writerProfile,
          team,
          skills: fixSkills,
          evidenceRefs: refs,
          evidenceThreads: (await context.stores.threads.list()).map(toEvidenceScopeThread),
          workdir: thread.workdir,
          repo: thread.repo,
          sop: await refreshSopBoard(context, threadId, team),
        }),
        writeQueue,
        randomUUID(),
        fixSkills.map((skill) => skill.id),
        refs.map((entry) => entry.id),
      );
      await gitAddAll(thread.workdir);
      const from = await resolveDiffMarker(thread.workdir, thread.repo);
      latestDiff = (await gitDiffHead(thread.workdir, from)) ?? latestDiff;
      reviewComment = await runReview();
    }
  }

  const card = await context.stores.approvals.create({
    threadId,
    writerAgentId,
    reviewerAgentId: reviewerAgentId ?? writerAgentId,
    diffText: latestDiff.text,
    diffStat: latestDiff.stat,
  });
  await context.stores.approvals.setReviewComment(card.id, reviewComment);

  const writerTexts = (await context.stores.messages.list(threadId))
    .filter((m) => m.role === 'assistant' && m.agentId === writerAgentId)
    .map((m) => m.content);
  const gated = gateReviewVerdict(reviewComment, writerTexts);
  const writerProfile = await context.stores.profiles.get(writerAgentId);
  const wantAuto = allowsAutoApprove(reviewComment, writerProfile?.autoApprove, writerTexts);
  let autoApplied = false;
  let landFail: string | undefined;
  if (wantAuto) {
    await context.stores.approvals.approve(card.id);
    const land = await landApprovedCard({
      context,
      threadId,
      workdir: thread.workdir,
      cardId: card.id,
      repo: thread.repo,
    });
    if (land.ok) autoApplied = true;
    else landFail = land.reason;
  }

  const revise = gated === 'revise';
  const incomplete = gated === 'incomplete';
  turnLog('card', {
    thread: threadId,
    id: card.id,
    verdict: gated,
    auto: autoApplied,
    stat: clip(latestDiff.stat, 60),
  });
  await context.stores.messages.append({
    threadId,
    role: 'system',
    content: autoApplied
      ? `🤖 审批卡片 ${card.id}(写:${writerAgentId} → 审:${reviewerAgentId})\n改动:${latestDiff.stat}\n审查意见:${reviewComment}\n✅ 已自动批准(autoApprove)`
      : revise
        ? `📋 审批卡片 ${card.id}(写:${writerAgentId} → 审:${reviewerAgentId})\n改动:${latestDiff.stat}\n审查意见:${reviewComment}\n互审后仍需修改，请你决定是否落地。\n回复 #approve ${card.id} 批准 / #reject ${card.id} <理由> 打回`
        : incomplete
          ? `📋 审批卡片 ${card.id}(写:${writerAgentId} → 审:${reviewerAgentId})\n改动:${latestDiff.stat}\n审查意见:${reviewComment}\n⚠️ 结论不算通过:没有本轮验证证据（命令+结果）。\n回复 #approve ${card.id} 批准 / #reject ${card.id} <理由> 打回`
          : `📋 审批卡片 ${card.id}(写:${writerAgentId} → 审:${reviewerAgentId})\n改动:${latestDiff.stat}\n审查意见:${reviewComment}\n回复 #approve ${card.id} 批准 / #reject ${card.id} <理由> 打回`,
    status: 'completed',
    systemKind: autoApplied ? 'approval-applied' : 'approval-pending',
    systemMeta: { verdict: gated },
  });
  if (landFail) {
    await context.stores.messages.append({
      threadId,
      role: 'system',
      content: `⚠️ 批准记下了，但提交失败：${landFail}`,
      status: 'completed',
      systemKind: 'approval-failed',
    });
  }
}
