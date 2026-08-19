import { extractConclusion, PASS_RE, REVISE_RE } from './review-conclusion';

export type MessageBlockKind = 'text' | 'approval' | 'evidence' | 'receipt';
export type ApprovalUiStatus = 'pending' | 'applied' | 'rejected';

export interface ParsedMessage {
  kind: MessageBlockKind;
  text?: string;
  approvalId?: string;
  evidenceId?: string;
  title?: string;
  stat?: string;
  comment?: string;
  writerId?: string;
  reviewerId?: string;
  approvalStatus?: ApprovalUiStatus;
}

const APPROVAL_PATTERN =
  /[📋🤖] 审批卡片 (ap_[a-f0-9]{8})(?:\(写:(\S+) → 审:(\S+)\))?[\s\S]*?改动:([^\n]*)[\s\S]*?审查意见:([\s\S]*?)(?:\n回复 |\n✅ |$)/;
/** kind 在、卡片套话改了时仍抠 id / 写审 / 改动 / 意见 */
const APPROVAL_FIELDS_PATTERN =
  /(ap_[a-f0-9]{8})(?:\(写:(\S+) → 审:(\S+)\))?[\s\S]*?改动:([^\n]*)[\s\S]*?审查意见:([\s\S]*?)(?:\n回复 |\n✅ |$)/;
const EVIDENCE_PATTERN =
  /💡 建议沉淀为证据:「([^」]*)」[\s\S]*?#confirm (ev_[a-f0-9]{8})/;
const RECEIPT_PATTERN = /^[✅⛔⚠️]/;
const PROTOCOL_USER_PATTERN = /^(#approve|#reject|#confirm)\b/;
const APPROVAL_RECEIPT_PATTERN = /^(✅ 已批准并落地|⛔ 已打回)/;

export function parseMessage(message: {
  role: string;
  content: string;
  systemKind?: string;
}): ParsedMessage {
  if (message.role === 'system') {
    const approvalKind =
      message.systemKind === 'approval-pending' || message.systemKind === 'approval-applied';
    const approval = message.content.match(approvalKind ? APPROVAL_FIELDS_PATTERN : APPROVAL_PATTERN);
    if (approval?.[1]) {
      const autoApplied =
        message.systemKind === 'approval-applied' || message.content.includes('已自动批准');
      return {
        kind: 'approval',
        approvalId: approval[1],
        writerId: approval[2] || undefined,
        reviewerId: approval[3] || undefined,
        stat: (approval[4] ?? '').trim(),
        comment: (approval[5] ?? '').trim(),
        approvalStatus: autoApplied ? 'applied' : 'pending',
      };
    }
    const evidence = message.content.match(EVIDENCE_PATTERN);
    if (evidence?.[2]) {
      return {
        kind: 'evidence',
        evidenceId: evidence[2],
        title: evidence[1] ?? '',
      };
    }
    if (RECEIPT_PATTERN.test(message.content)) {
      return { kind: 'receipt', text: message.content };
    }
  }
  return { kind: 'text', text: message.content };
}

export function isHiddenChatMessage(message: {
  role: string;
  content: string;
  systemKind?: string;
}): boolean {
  const content = message.content.trim();
  if (message.role === 'user' && PROTOCOL_USER_PATTERN.test(content)) return true;
  if (message.role === 'system' && APPROVAL_RECEIPT_PATTERN.test(content)) return true;
  return false;
}

export function approvalStatusFromDto(status: string | undefined): ApprovalUiStatus | undefined {
  if (!status) return undefined;
  if (status === 'applied' || status === 'approved') return 'applied';
  if (status === 'rejected') return 'rejected';
  if (status === 'draft' || status === 'reviewing') return 'pending';
  return undefined;
}

function reviewLooksRevise(comment: string): boolean {
  const source = extractConclusion(comment) ?? comment;
  const reviseIdx = source.search(REVISE_RE);
  const passIdx = source.search(PASS_RE);
  return reviseIdx >= 0 && (passIdx < 0 || reviseIdx <= passIdx);
}

export function approvalCardTitle(status: ApprovalUiStatus, comment = ''): string {
  if (status === 'applied') return '改动已确认';
  if (status === 'rejected') return '已打回';
  if (reviewLooksRevise(comment)) return '互审未通过，待你决定';
  return '审查通过，待你确认';
}
