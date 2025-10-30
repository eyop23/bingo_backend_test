const crypto = require('crypto');

/**
 * Seeded random number generator (function-based)
 * Uses card number as seed to ensure same card always gets same grid
 */
function createSeededRandom(seed) {
  let currentSeed = seed;

  // Linear congruential generator
  function next() {
    currentSeed = (currentSeed * 9301 + 49297) % 233280;
    return currentSeed / 233280;
  }

  // Get random integer between min (inclusive) and max (exclusive)
  function nextInt(min, max) {
    return Math.floor(next() * (max - min)) + min;
  }

  return { next, nextInt };
}

/**
 * Generates a deterministic BINGO card based on card number
 * Same cardNumber will always produce the same grid
 *
 * @param {Number} cardNumber - The card number (1-999)
 * @returns {Array} - 5x5 grid for BINGO card
 */
function generateDeterministicBingoCard(cardNumber) {
  const rng = createSeededRandom(cardNumber);

  const columnRanges = [
    [1, 15],    // B
    [16, 30],   // I
    [31, 45],   // N
    [46, 60],   // G
    [61, 75]    // O
  ];

  const grid = [];

  for (let col = 0; col < 5; col++) {
    const [min, max] = columnRanges[col];
    const numbers = [];

    // Generate available numbers for this column
    const availableNumbers = [];
    for (let i = min; i <= max; i++) {
      availableNumbers.push(i);
    }

    // Shuffle using seeded random
    for (let i = availableNumbers.length - 1; i > 0; i--) {
      const j = rng.nextInt(0, i + 1);
      [availableNumbers[i], availableNumbers[j]] = [availableNumbers[j], availableNumbers[i]];
    }

    // Pick first 5 numbers for this column
    for (let row = 0; row < 5; row++) {
      // Special case: center of N column is FREE
      if (col === 2 && row === 2) {
        numbers.push(0); // 0 represents FREE space
      } else {
        numbers.push(availableNumbers[row]);
      }
    }

    grid.push(numbers);
  }

  return grid;
}

module.exports = { generateDeterministicBingoCard };