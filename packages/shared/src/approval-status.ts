import type { ApprovalStatus } from './types.js';

/**
 * 还能被人拍板 / 还在等落地的状态。
 *
 * `approved` 也算「还开着」：人批了但提交失败的卡会停在这里，而 `#approve` 打上去会
 * 再走一遍落地。所以它和 `draft` / `reviewing` 一样，在改动已经进了基准分支之后
 * 仍会邀请一个必然失败的动作。
 */
const VOIDABLE: readonly ApprovalStatus[] = ['draft', 'reviewing', 'approved'];

export function isVoidableApprovalStatus(status: ApprovalStatus): boolean {
  return VOIDABLE.includes(status);
}
