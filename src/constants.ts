// Application Constants

export const Constants = {
  VERSION: '0.1.0',
  ACTIVITY_CLASS: 'better-ghub-activity',
  PROCESSED_ATTR: 'data-better-ghub-processed',
  CACHE_DURATION: 5 * 60 * 1000, // 5 minutes
  BATCH_DELAY: 500,
} as const;

export type Constants = typeof Constants;
