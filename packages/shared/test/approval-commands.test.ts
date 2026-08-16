import { describe, expect, it } from 'vitest';
import { parseApproveCommand, parseRejectCommand } from '../src/commands.js';

describe('parseApproveCommand', () => {
  it('解析 #approve ap_xxx', () => {
    expect(parseApproveCommand('#approve ap_a1b2c3d4')).toEqual({ id: 'ap_a1b2c3d4' });
  });

  it('普通消息返回 null', () => {
    expect(parseApproveCommand('好的')).toBeNull();
  });
});

describe('parseRejectCommand', () => {
  it('解析 #reject 带理由', () => {
    expect(parseRejectCommand('#reject ap_a1b2c3d4 边界没覆盖')).toEqual({
      id: 'ap_a1b2c3d4',
      reason: '边界没覆盖',
    });
  });

  it('无理由也返回(空理由)', () => {
    expect(parseRejectCommand('#reject ap_a1b2c3d4')).toEqual({
      id: 'ap_a1b2c3d4',
      reason: '',
    });
  });

  it('普通消息返回 null', () => {
    expect(parseRejectCommand('不同意')).toBeNull();
  });
});
