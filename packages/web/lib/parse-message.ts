export type MessageBlockKind = 'text' | 'approval' | 'evidence' | 'receipt';

export interface ParsedMessage {
  kind: MessageBlockKind;
  text?: string;
  approvalId?: string;
  evidenceId?: string;
  title?: string;
  stat?: string;
  comment?: string;
}

const APPROVAL_PATTERN =
  /📋 审批卡片 (ap_[a-f0-9]{8})[\s\S]*?改动:([^\n]*)[\s\S]*?审查意见:([^\n]*)/;
const EVIDENCE_PATTERN =
  /💡 建议沉淀为证据:「([^」]*)」[\s\S]*?#confirm (ev_[a-f0-9]{8})/;
const RECEIPT_PATTERN = /^[✅⛔⚠️]/;

export function parseMessage(message: { role: string; content: string }): ParsedMessage {
  if (message.role === 'system') {
    const approval = message.content.match(APPROVAL_PATTERN);
    if (approval?.[1]) {
      return {
        kind: 'approval',
        approvalId: approval[1],
        stat: approval[2] ?? '',
        comment: approval[3] ?? '',
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
