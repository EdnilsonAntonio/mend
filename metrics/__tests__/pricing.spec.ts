import { test, expect } from '@playwright/test';
import {
  lookupModelPrice,
  costUsd,
  MODEL_PRICING,
} from '../pricing.js';

test('lookupModelPrice finds gpt-4o-mini', () => {
  const price = lookupModelPrice('gpt-4o-mini');
  expect(price).not.toBeNull();
  expect(price?.inputUsdPerMillionTokens).toBe(0.15);
  expect(price?.outputUsdPerMillionTokens).toBe(0.6);
});

test('lookupModelPrice normalises dated snapshot suffix', () => {
  const price1 = lookupModelPrice('gpt-4o-mini');
  const price2 = lookupModelPrice('GPT-4o-mini-2024-07-18');
  expect(price2).toEqual(price1);
});

test('lookupModelPrice returns null for unknown models', () => {
  expect(lookupModelPrice('some-unknown-model')).toBeNull();
  expect(lookupModelPrice(null)).toBeNull();
  expect(lookupModelPrice('  ')).toBeNull();
});

test('costUsd calculates correctly for 1M tokens each', () => {
  const price = MODEL_PRICING['gpt-4o-mini'];
  if (!price) throw new Error('gpt-4o-mini not found');
  const cost = costUsd(price, 1_000_000, 1_000_000);
  expect(cost).toBe(price.inputUsdPerMillionTokens + price.outputUsdPerMillionTokens);
  expect(cost).toBe(0.75);
});

test('costUsd returns 0 for 0 tokens', () => {
  const price = MODEL_PRICING['gpt-4o-mini'];
  if (!price) throw new Error('gpt-4o-mini not found');
  const cost = costUsd(price, 0, 0);
  expect(cost).toBe(0);
});
