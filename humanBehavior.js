function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function sleepJitter(minMs, maxMs) {
  await sleep(Math.round(rand(minMs, maxMs)));
}

async function humanScroll(page, passes = 8, opts = {}) {
  const { minStep = 200, maxStep = 800, minPause = 150, maxPause = 700 } = opts;
  for (let i = 0; i < passes; i++) {
    const step = Math.round(rand(minStep, maxStep));
    await page.mouse.wheel(0, step);
    await sleepJitter(minPause, maxPause);
    // occasional small upward scroll
    if (Math.random() < 0.18) {
      await page.mouse.wheel(0, -Math.round(step * rand(0.1, 0.3)));
      await sleepJitter(80, 180);
    }
  }
}

async function humanMouseWiggle(page, durationMs = 800) {
  const start = Date.now();
  const box = { w: 300, h: 200 };
  const originX = Math.round(rand(100, 600));
  const originY = Math.round(rand(100, 400));
  await page.mouse.move(originX, originY);
  while (Date.now() - start < durationMs) {
    const x = originX + Math.round(rand(-box.w / 2, box.w / 2));
    const y = originY + Math.round(rand(-box.h / 2, box.h / 2));
    await page.mouse.move(x, y, { steps: Math.round(rand(2, 6)) });
    await sleepJitter(30, 120);
  }
}

module.exports = {
  sleepJitter,
  humanScroll,
  humanMouseWiggle
};


