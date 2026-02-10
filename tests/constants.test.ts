/**
 * @jest-environment jsdom
 */

import { Constants } from '../src/constants';

describe('Constants', () => {
  test('should have VERSION defined', () => {
    expect(Constants.VERSION).toBeDefined();
    expect(typeof Constants.VERSION).toBe('string');
    expect(Constants.VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('should have ACTIVITY_CLASS defined', () => {
    expect(Constants.ACTIVITY_CLASS).toBe('better-ghub-activity');
  });

  test('should have PROCESSED_ATTR defined', () => {
    expect(Constants.PROCESSED_ATTR).toBe('data-better-ghub-processed');
  });

  test('should have CACHE_DURATION as number', () => {
    expect(typeof Constants.CACHE_DURATION).toBe('number');
    expect(Constants.CACHE_DURATION).toBeGreaterThan(0);
  });

  test('should have BATCH_DELAY as number', () => {
    expect(typeof Constants.BATCH_DELAY).toBe('number');
    expect(Constants.BATCH_DELAY).toBeGreaterThan(0);
  });

  test('cache duration should be 2 minutes in milliseconds', () => {
    expect(Constants.CACHE_DURATION).toBe(2 * 60 * 1000);
  });

  test('batch delay should be 500ms', () => {
    expect(Constants.BATCH_DELAY).toBe(500);
  });
});
