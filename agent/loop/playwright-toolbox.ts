import { chromium } from '@playwright/test';
import type { ClassifiedFailure } from '../classifier/failure-classifier.js';
import {
  getDomSnapshot,
  type DomSnapshot,
} from '../tools/get-dom-snapshot.js';
import { querySelector, type QuerySelectorResult } from '../tools/query-selector.js';
import {
  runSingleTest,
  type RunSingleTestResult,
} from '../tools/run-single-test.js';
import type { HealToolbox } from './types.js';

export const DEFAULT_APP_URL = 'http://localhost:3100/';

export interface PlaywrightToolbox extends HealToolbox {
  close(): Promise<void>;
}

export async function createPlaywrightToolbox(
  failure: ClassifiedFailure,
  options?: { readonly appUrl?: string; readonly timeoutMs?: number },
): Promise<PlaywrightToolbox> {
  const appUrl = options?.appUrl ?? DEFAULT_APP_URL;
  const timeoutMs = options?.timeoutMs;

  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(appUrl, { waitUntil: 'load' });

    // Capture these once at construction, unreachable from model
    const specFile = failure.specFile;
    const testName = failure.testName;
    const originalSelector = failure.selector ?? '';

    const toolbox: PlaywrightToolbox = {
      getDomSnapshot: async (): Promise<DomSnapshot> => {
        return getDomSnapshot(page);
      },
      querySelector: async (selector: string): Promise<QuerySelectorResult> => {
        return querySelector(page, selector);
      },
      runSingleTest: async (candidateSelector: string): Promise<RunSingleTestResult> => {
        return runSingleTest({
          specFile,
          testName,
          originalSelector,
          candidateSelector,
          timeoutMs,
        });
      },
      close: async (): Promise<void> => {
        await browser!.close();
      },
    };

    return toolbox;
  } catch (error) {
    if (browser) {
      await browser.close();
    }
    throw error;
  }
}
