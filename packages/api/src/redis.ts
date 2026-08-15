import { Redis } from 'ioredis';

export function createRedisClient(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: 2 });
}

export async function assertStorageReady(redis: Redis): Promise<void> {
  const pong = await redis.ping();
  if (pong !== 'PONG') {
    throw new Error('Redis ping 失败,请确认 redis-server 已启动');
  }
}
