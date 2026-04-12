#!/usr/bin/env node

const puppeteer = require('puppeteer');

const SECOND_HAND_ITEMS = [
  'Nike Air Force 1',
  'Levi\'s 501 jeans',
  'Fjallraven Kanken backpack',
  'Adidas Stan Smith',
  'Zara trench coat',
  'North Face puffer jacket',
  'Doc Martens 1460',
  'Uniqlo wool sweater',
  'Ray-Ban Wayfarer',
  'Patagonia fleece',
  'Vintage denim jacket',
  'Converse Chuck Taylor'
];

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

async function fillAndSubmit({ page, inputSelector, buttonSelector, item }) {
  await page.waitForSelector(inputSelector, { visible: true, timeout: 15000 });

  const input = await page.$(inputSelector);
  if (!input) {
    throw new Error(`Input not found for selector: ${inputSelector}`);
  }

  await input.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await input.type(item, { delay: 40 });

  await page.waitForSelector(buttonSelector, { visible: true, timeout: 10000 });
  await page.click(buttonSelector);
}

async function waitForListings(page, timeout = 30000) {
  await page.waitForFunction(() => window.location.pathname.includes('/chat'), {
    timeout
  });

  await page.waitForSelector('#listings-view', {
    visible: true,
    timeout
  });
}

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1
    }
  });

  const context = browser.defaultBrowserContext();
  const page = await browser.newPage();

  const location = pickRandom(ITALIAN_LOCATIONS);
  const latitude = jitter(location.lat);
  const longitude = jitter(location.lon);

  await context.overridePermissions('https://miraserch.ai', ['geolocation']);
  await page.setGeolocation({ latitude, longitude, accuracy: 100 });

  console.log(
    `Using geolocation near ${location.city}, Italy (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`
  );

  try {
    await page.goto('https://miraserch.ai', { waitUntil: 'domcontentloaded', timeout: 60000 });

    const firstItem = pickRandom(SECOND_HAND_ITEMS);
    console.log(`First query: ${firstItem}`);

    await fillAndSubmit({
      page,
      inputSelector: 'textarea[aria-label]',
      buttonSelector: 'button[aria-label="Send button"]',
      item: firstItem
    });

    try {
      await waitForListings(page, 30000);
      console.log('✅ listings-view became visible after first attempt.');
    } catch (firstErr) {
      console.warn(
        '⚠️ listings-view was not visible within 30s after first attempt; retrying with fallback selectors...'
      );

      const secondItem = pickRandom(
        SECOND_HAND_ITEMS.filter((item) => item !== firstItem)
      );
      console.log(`Second query: ${secondItem}`);

      await fillAndSubmit({
        page,
        inputSelector: 'textarea[name="message"]',
        buttonSelector: 'button[type="submit"]',
        item: secondItem
      });

      await waitForListings(page, 30000);
      console.log('✅ listings-view became visible after retry.');
    }
  } catch (err) {
    console.error('❌ Script failed:', err);
    process.exitCode = 1;
  } finally {
    await page.waitForTimeout(2000);
    await browser.close();
  }
})();
