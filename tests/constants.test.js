/**
 * @jest-environment jsdom
 */

describe('BetterGHub_Constants', () => {
  let BetterGHub_Constants;

  beforeAll(() => {
    // Load the constants file
    const fs = require('fs');
    const path = require('path');
    const constantsPath = path.join(__dirname, '..', 'src', 'constants.js');
    const constantsCode = fs.readFileSync(constantsPath, 'utf8');
    
    // Execute the code in a safer way
    const evalFunc = new Function(constantsCode + '; return BetterGHub_Constants;');
    BetterGHub_Constants = evalFunc();
    global.BetterGHub_Constants = BetterGHub_Constants;
  });

  test('should have VERSION defined', () => {
    expect(BetterGHub_Constants.VERSION).toBeDefined();
    expect(typeof BetterGHub_Constants.VERSION).toBe('string');
    expect(BetterGHub_Constants.VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('should have ACTIVITY_CLASS defined', () => {
    expect(BetterGHub_Constants.ACTIVITY_CLASS).toBe('better-ghub-activity');
  });

  test('should have PROCESSED_ATTR defined', () => {
    expect(BetterGHub_Constants.PROCESSED_ATTR).toBe('data-better-ghub-processed');
  });

  test('should have CACHE_DURATION as number', () => {
    expect(typeof BetterGHub_Constants.CACHE_DURATION).toBe('number');
    expect(BetterGHub_Constants.CACHE_DURATION).toBeGreaterThan(0);
  });

  test('should have BATCH_DELAY as number', () => {
    expect(typeof BetterGHub_Constants.BATCH_DELAY).toBe('number');
    expect(BetterGHub_Constants.BATCH_DELAY).toBeGreaterThan(0);
  });

  test('cache duration should be 5 minutes in milliseconds', () => {
    expect(BetterGHub_Constants.CACHE_DURATION).toBe(5 * 60 * 1000);
  });

  test('batch delay should be 500ms', () => {
    expect(BetterGHub_Constants.BATCH_DELAY).toBe(500);
  });
});

