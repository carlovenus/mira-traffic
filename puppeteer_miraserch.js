#!/usr/bin/env node

const puppeteer = require('puppeteer');
const SECOND_HAND_ITEMS = require('./second_hand_items.json');

const TAB_COUNT = 5;

const ITALIAN_LOCATIONS = [
  { city: 'Milan', lat: 45.4642, lon: 9.19 },
  { city: 'Rome', lat: 41.9028, lon: 12.4964 },
  { city: 'Naples', lat: 40.8518, lon: 14.2681 },
  { city: 'Turin', lat: 45.0703, lon: 7.6869 },
  { city: 'Bologna', lat: 44.4949, lon: 11.3426 },
  { city: 'Florence', lat: 43.7696, lon: 11.2558 },
  { city: 'Venice', lat: 45.4408, lon: 12.3155 },
  { city: 'Bari', lat: 41.1171, lon: 16.8719 },
  { city: 'Palermo', lat: 38.1157, lon: 13.3615 },
  { city: 'Cagliari', lat: 39.2238, lon: 9.1217 }
];

function pickRandom(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function jitter(value, magnitude = 0.02) {
  return value + (Math.random() * 2 - 1) * magnitude;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function activatePage(page) {
  try {
    await page.bringToFront();
    await delay(150);
  } catch (err) {
    console.warn('bringToFront failed:', err.message);
  }
}

async function fillAndSubmit({ page, inputSelector, buttonSelector, item }) {
  await activatePage(page);

  await page.waitForSelector(inputSelector, { visible: true, timeout: 15000 });

  const input = await page.$(inputSelector);
  if (!input) {
    throw new Error(`Input not found for selector: ${inputSelector}`);
  }

  await input.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await input.type(item, { delay: 40 });

  await page.waitForSelector(buttonSelector, { visible: true, timeout: 10000 });
  await activatePage(page);
  await page.click(buttonSelector);
}

async function waitForListings(page, timeout = 30000) {
  await activatePage(page);

  await page.waitForFunction(() => window.location.pathname.includes('/chat'), {
    timeout
  });

  await page.waitForSelector('#listings-view', {
    visible: true,
    timeout
  });
}

async function clickFirstListingImage(page) {
  const selector = '.product-card img';

  try {
    await activatePage(page);
    await page.waitForSelector(selector, { timeout: 100000 });

    const images = await page.$$(selector);
    if (images.length === 0) {
      throw new Error(`No elements found for selector: ${selector}`);
    }

    for (const [index, image] of images.entries()) {
      const box = await image.boundingBox();
      if (!box || box.width === 0 || box.height === 0) {
        continue;
      }

      await image.evaluate((el) => {
        el.scrollIntoView({ block: 'center', inline: 'center' });
      });

      await delay(300);
      await activatePage(page);

      try {
        await image.click({ delay: 50 });
        console.log(`Clicked image ${index}`);
        return;
      } catch (err) {
        console.log(`Failed clicking image ${index}: ${err.message}`);

        // fallback: DOM click
        try {
          await image.evaluate((el) => el.click());
          console.log(`Clicked image ${index} via evaluate`);
          return;
        } catch (evalErr) {
          console.log(`Evaluate click failed for image ${index}: ${evalErr.message}`);
        }
      }
    }

    throw new Error(`No clickable visible image found for selector: ${selector}`);
  } catch (err) {
    console.error('clickFirstListingImage failed:', err);
    throw err;
  }
}

async function postListingsAction(page) {
  await activatePage(page);
  await delay(5000);
  console.log('postListingsAction pre');
  await clickFirstListingImage(page);
  console.log('postListingsAction post');
  await delay(5000);
}

async function executeGoogleOriginFlow(page, tabNumber, item) {
  await activatePage(page);

  await page.goto(`https://www.google.com/search?q=${encodeURIComponent(item)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  const firstResultSelector = 'a h3';
  await page.waitForSelector(firstResultSelector, { visible: true, timeout: 20000 });

  const firstResult = await page.$(firstResultSelector);
  if (!firstResult) {
    throw new Error(`[Tab ${tabNumber}] No Google result found to click.`);
  }

  await activatePage(page);

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
    firstResult.click()
  ]);
}

async function runTabFlow(context, tabNumber, origin) {
  const page = await context.newPage();

  await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
  );

  await page.setExtraHTTPHeaders({
    'Accept-Language': 'it-IT,it;q=0.9'
  });

  await page.emulateTimezone('Europe/Rome');

  const location = pickRandom(ITALIAN_LOCATIONS);
  const latitude = jitter(location.lat);
  const longitude = jitter(location.lon);

  await page.setGeolocation({ latitude, longitude, accuracy: 100 });

  console.log(
      `[Tab ${tabNumber}] Using geolocation near ${location.city}, Italy (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`
  );

  try {
    // small stagger so all 5 tabs don't compete at the same instant
    await delay((tabNumber - 1) * 1200);

    const firstItem = pickRandom(SECOND_HAND_ITEMS);

    if (origin === 'google') {
      console.log(`[Tab ${tabNumber}] Starting user journey from Google.`);
      await executeGoogleOriginFlow(page, tabNumber, firstItem);
    } else {
      await activatePage(page);
      await page.goto('https://mirasearch.ai', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
    }

    console.log(`[Tab ${tabNumber}] First query: ${firstItem}`);

    await fillAndSubmit({
      page,
      inputSelector: 'textarea[aria-label]',
      buttonSelector: 'button[type="submit"]',
      item: firstItem
    });

    try {
      await waitForListings(page, 60000);
      console.log(`[Tab ${tabNumber}] ✅ listings-view visible after first attempt.`);
      await postListingsAction(page);
    } catch (firstErr) {
      console.error(`[Tab ${tabNumber}] listings flow failed:`, firstErr.message);
      throw firstErr;
    }
  } finally {
    await page.close();
  }
}

(async () => {
  const rawOrigin = process.argv[2];
  const origin = rawOrigin && rawOrigin.trim() !== '' ? rawOrigin : null;

  if (origin !== null && origin !== 'google') {
    console.error(`❌ Invalid origin "${origin}". Supported values: "google" or no value.`);
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: {
      width: 1920,
      height: 1280,
      deviceScaleFactor: 1
    },
    args: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ]
  });

  const context = browser.defaultBrowserContext();
  await context.overridePermissions('https://mirasearch.ai', ['geolocation']);

  try {
    const tabRuns = Array.from({ length: TAB_COUNT }, (_, index) =>
        runTabFlow(context, index + 1, origin)
    );

    const results = await Promise.allSettled(tabRuns);
    const failures = results.filter((result) => result.status === 'rejected');

    if (failures.length > 0) {
      failures.forEach((result, index) => {
        console.error(`❌ Tab failure ${index + 1}:`, result.reason);
      });
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('❌ Script failed:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();