/* format.js — number and time formatting for priv-esc.
   Plain browser script: defines the display helpers on window. */

(function () {
  // Short-scale names, one per three zeros. The ladder in data-upgrades.js
  // ends at duodecillion (1e39), so the table has to name that far.
  const SUFFIXES = [
    '', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc',
    'Ud', 'Dd', 'Td', 'Qad',
  ];
  const EXP_LIMIT = 1e48;

  // Drop trailing zeroes so "1.50K" reads "1.5K" and "1.00K" reads "1K".
  function trimZeros(s) {
    if (s.indexOf('.') === -1) return s;
    return s.replace(/\.?0+$/, '');
  }

  // Three significant digits in the mantissa: 1.23M, 45.6B, 789T.
  function formatMantissa(mantissa) {
    const decimals = Math.max(0, 2 - Math.floor(Math.log10(mantissa)));
    return trimZeros(mantissa.toFixed(decimals));
  }

  function exponential(value) {
    return value.toExponential(2).replace('e+', 'e');
  }

  function fmt(n) {
    if (!isFinite(n)) return '—';
    if (n === 0) return '0';

    const sign = n < 0 ? '-' : '';
    const value = Math.abs(n);

    if (value < 1000) {
      const rounded = Math.round(value * 10) / 10;
      // 999.96 rounds up to 1000, which reads better as "1K".
      if (rounded < 1000) return sign + trimZeros(rounded.toFixed(1));
    }

    if (value >= EXP_LIMIT) return sign + exponential(value);

    let tier = Math.floor(Math.log10(value) / 3);
    let text = formatMantissa(value / Math.pow(1000, tier));

    // Rounding can push 999.9T up to 1000T; carry it into the next suffix.
    if (Number(text) >= 1000) {
      tier += 1;
      if (tier >= SUFFIXES.length) return sign + exponential(value);
      text = formatMantissa(value / Math.pow(1000, tier));
    }

    return sign + text + SUFFIXES[tier];
  }

  function fmtRate(n) {
    return '+' + fmt(n) + ' /s';
  }

  function fmtPct(n) {
    if (!isFinite(n)) return '—';
    return Math.round(n * 100) + '%';
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function fmtTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '—';

    const total = Math.floor(seconds);

    if (total < 60) return total + 's';

    if (total < 3600) {
      return Math.floor(total / 60) + 'm ' + pad2(total % 60) + 's';
    }

    if (total < 86400) {
      return Math.floor(total / 3600) + 'h ' + pad2(Math.floor((total % 3600) / 60)) + 'm';
    }

    return Math.floor(total / 86400) + 'd ' + pad2(Math.floor((total % 86400) / 3600)) + 'h';
  }

  function fmtClock(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '—';

    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;

    return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  }

  function fmtMult(n) {
    if (!isFinite(n)) return '—';
    return 'x' + n.toFixed(2);
  }

  /**
   * Compact form for the header: the same number, but never wider than
   * "1.23Ud". Past the named suffixes it falls back to a short exponent, so
   * the DATA readout cannot push the header out of shape.
   */
  function fmtCompact(n) {
    if (!isFinite(n)) return '—';
    if (n === 0) return '0';
    const value = Math.abs(n);
    if (value < 1000) return fmt(n);
    if (value >= EXP_LIMIT) {
      const exp = Math.floor(Math.log10(value));
      const mant = value / Math.pow(10, exp);
      return (n < 0 ? '-' : '') + mant.toFixed(1) + 'e' + exp;
    }
    return fmt(n);
  }

  window.fmt = fmt;
  window.fmtRate = fmtRate;
  window.fmtPct = fmtPct;
  window.fmtTime = fmtTime;
  window.fmtClock = fmtClock;
  window.fmtMult = fmtMult;
  window.fmtCompact = fmtCompact;
})();
