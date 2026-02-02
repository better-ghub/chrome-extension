// Application Constants

export const Constants = {
  VERSION: '0.2.0',
  ACTIVITY_CLASS: 'better-ghub-activity',
  PROCESSED_ATTR: 'data-better-ghub-processed',
  CACHE_DURATION: 2 * 60 * 1000, // 2 minutes
  BATCH_DELAY: 500,
} as const;

export type Constants = typeof Constants;
