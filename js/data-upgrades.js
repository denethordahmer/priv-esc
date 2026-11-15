/* =========================================================================
   priv-esc — data-upgrades.js
   Upgrade catalogue and balance constants.

   Numbers were produced by an economy simulator (see /tmp/simulate_v5.py)
   and tuned to these targets:
     10,000 Data      ~13 minutes of active play
     1,000,000 Data   ~1.5 hours
     1 billion Data   ~13 hours
     1 trillion Data  ~3.2 days  (first prestige)
   Upgrades are still being bought at the 1T wall, so the shop never goes
   empty before the player prestiges.

   COST RULE
     Every repeatable upgrade costs:  base * 1.15 ^ owned
   Each named item inside a subcategory has a base cost raised 10-50x over
   the previous item, so a cheap early unit can never undercut a late one.

   MULTIPLIER RULE
     Global multiplier and cost-reduction upgrades have no level cap. Their
     growth is held in check by the square-root curve in globalMultiplier(),
     which gives strong early returns and diminishing later ones. A hard cap
     was tried and removed: it froze income and made the late game unreachable.

   SELLING
     Every upgrade can be sold back for 70% of what it cost. Cooling used to
     carry a shared cap of 40 levels, which meant cheap coolers blocked the
     expensive ones and there was no way to undo a purchase. Both are gone.
   ========================================================================= */

const COST_GROWTH = 1.15;

const CATEGORIES = [
  {
    id: 'hardware',
    name: 'Hardware',
    icon: '🖥️',
    blurb: 'The physical rig.',
    subs: [
      {
        id: 'input', name: 'Input Devices', focus: 'Click power',
        kind: 'click', items: [
          { name: 'Membrane Keyboard',      desc: 'Cheap, squishy keys.',                     base: 1.35,  eff: 0.60 },
          { name: 'Rubber Dome Keyboard',   desc: 'Slightly better tactile response.',        base: 18.9,  eff: 1.20 },
          { name: 'Mechanical Switches',    desc: 'Crisp, audible clicks.',                   base: 264.6,   eff: 2.40 },
          { name: 'Optical Switches',       desc: 'Light-speed actuation.',                   base: 3704.4,  eff: 4.80 },
          { name: 'Hall Effect Keyboard',   desc: 'Magnetic, adjustable actuation.',          base: 51861.6, eff: 9.60 },
          { name: 'Neural-Link Gloves',     desc: 'Your hands move at the speed of thought.', base: 726062, eff: 19.2 },
          { name: 'Haptic Feedback Deck',   desc: 'A macro-pad that vibrates with each click.', base: 1.01649e+07, eff: 38.4 },
        ],
      },
      {
        id: 'proc', name: 'Processors', focus: 'Global multiplier',
        kind: 'mult', items: [
          { name: 'Dual-Core CPU',        desc: 'Basic multitasking.',            base: 27,      eff: 0.010 },
          { name: 'Quad-Core CPU',        desc: 'Better parallel processing.',    base: 540,     eff: 0.010 },
          { name: 'Overclocked i9',       desc: 'Consumer hardware at its limit.', base: 10800,   eff: 0.010 },
          { name: 'Threadripper Server',  desc: 'Enterprise-grade processing.',   base: 216000,  eff: 0.010 },
          { name: 'FPGA',                 desc: 'Custom-built hardware logic.',   base: 4.32e+06,   eff: 0.010 },
          { name: 'ASIC Miner',           desc: 'Built purely for brute-forcing.', base: 8.64e+07,  eff: 0.010 },
          { name: 'Quantum Annealer',     desc: 'Solving complex equations instantly.', base: 1.728e+09, eff: 0.010 },
          { name: 'Photonic Processor',   desc: 'Processing with light.',         base: 3.456e+10, eff: 0.010 },
        ],
      },
      {
        id: 'mem', name: 'Memory', focus: 'Idle speed',
        kind: 'idle', items: [
          { name: 'DDR3 RAM',              desc: 'Outdated but functional.',       base: 13.5,  eff: 0.35 },
          { name: 'DDR4 RAM',              desc: 'Faster read/write.',             base: 201.6,  eff: 0.70 },
          { name: 'DDR5 RAM',              desc: 'Cutting-edge consumer memory.',  base: 3042, eff: 1.40 },
          { name: 'ECC Server Memory',     desc: 'Error-correcting, 24/7 uptime.', base: 45561.6, eff: 2.80 },
          { name: 'Cache Injection',       desc: 'Stealing memory from nearby servers.', base: 683437, eff: 5.60 },
          { name: 'Memristor Arrays',      desc: 'Memory that survives without power.',  base: 1.026e+07, eff: 11.2 },
          { name: 'Holographic Storage',   desc: 'Data in 3D light fields.',       base: 1.53e+08, eff: 22.4 },
        ],
      },
      {
        id: 'cool', name: 'Cooling', focus: 'Heat capacity',
        kind: 'heat', items: [
          { name: 'Stock Air Cooler',         desc: 'Bare minimum cooling.',        base: 9,   eff: 8 },
          { name: 'Noctua Air Cooler',        desc: 'Quiet and efficient.',         base: 126,  eff: 16 },
          { name: 'AIO Liquid Cooler',        desc: 'Pumping water through the rig.', base: 1764, eff: 32 },
          { name: 'Custom Water Loop',        desc: 'Hand-built for extreme setups.', base: 24696, eff: 64 },
          { name: 'Peltier Sub-Zero Cooler',  desc: 'Sub-ambient temperatures.',    base: 345744, eff: 128 },
          { name: 'Liquid Nitrogen Overclock',desc: 'Pouring LN2 on the CPU.',      base: 4.842e+06, eff: 256 },
          { name: 'Superfluid Helium Immersion', desc: 'A frictionless bath for the rig.', base: 6.768e+07, eff: 512 },
          { name: 'Cryo-Chamber',             desc: 'The server room at absolute zero.', base: 9.486e+08, eff: 1024 },
        ],
      },
    ],
  },
  {
    id: 'software',
    name: 'Software',
    icon: '💻',
    blurb: 'The code and the exploits.',
    subs: [
      {
        id: 'autoc', name: 'Click Scripts', focus: 'Auto-clicking',
        kind: 'auto', items: [
          { name: 'AutoHotkey Script',        desc: 'Basic looping macros.',                base: 72,   eff: 0.08 },
          { name: 'Python Selenium Bot',      desc: 'Automating browser interactions.',     base: 1584,  eff: 0.176 },
          { name: 'C++ Memory Injector',      desc: 'Manipulating game memory directly.',   base: 34848, eff: 0.387 },
          { name: 'Kernel-Level Macro',       desc: 'Hidden from the OS.',                  base: 766656, eff: 0.852 },
          { name: 'Polymorphic Clicker',      desc: 'Changes signature to avoid detection.', base: 1.6866e+07, eff: 1.874 },
          { name: 'AI Behavioral Mimic',      desc: 'Clicks like a human to avoid bans.',   base: 3.708e+08, eff: 4.12 },
        ],
      },
      {
        id: 'exploit', name: 'Data Exploits', focus: 'Data multipliers',
        kind: 'mult', items: [
          { name: 'SQL Injection',        desc: 'Stealing from poorly secured databases.', base: 450,   eff: 0.015 },
          { name: 'Cross-Site Scripting', desc: 'Injecting code into websites.',           base: 10800,  eff: 0.015 },
          { name: 'Buffer Overflow',      desc: 'Crashing systems to steal their memory.', base: 259200, eff: 0.015 },
          { name: 'Zero-Day Exploit',     desc: 'An undiscovered vulnerability.',          base: 6.228e+06, eff: 0.015 },
          { name: 'Ransomware Module',    desc: 'Encrypting data for Crypto.',             base: 1.494e+08, eff: 0.015 },
          { name: 'Rootkit Installation', desc: 'Hidden in the core files.',               base: 3.582e+09, eff: 0.015 },
          { name: 'Hardware Backdoor',    desc: 'Exploiting the physical chips.',          base: 8.604e+10, eff: 0.015 },
        ],
      },
      {
        id: 'compress', name: 'Compression', focus: 'Cost reduction',
        kind: 'cost', items: [
          { name: 'Zip File Archiver',          desc: 'Basic file compression.',        base: 270,  eff: 0.004 },
          { name: 'RAR Compression',            desc: 'Better compression ratios.',     base: 7560, eff: 0.004 },
          { name: 'Defragmentation Script',     desc: 'Optimising the file system.',    base: 211680, eff: 0.004 },
          { name: 'Entropy Reduction Algorithm',desc: 'Deleting useless data.',         base: 5.922e+06, eff: 0.004 },
          { name: 'Quantum Data Packing',       desc: 'Infinite data in finite space.', base: 1.6596e+08, eff: 0.004 },
          { name: 'Dark Matter Storage',        desc: 'Data in theoretical dark matter.', base: 4.644e+09, eff: 0.004 },
        ],
      },
    ],
  },
  {
    id: 'infrastructure',
    name: 'Infrastructure',
    icon: '🌐',
    blurb: 'The network.',
    subs: [
      {
        id: 'network', name: 'Networks', focus: 'Base idle Data',
        kind: 'idle', items: [
          { name: 'Dial-up Modem',      desc: 'Slow, noisy connection.',        base: 180,  eff: 1.6 },
          { name: 'Broadband Cable',    desc: 'High-speed internet.',           base: 3600, eff: 3.36 },
          { name: 'Fiber Optic Line',   desc: 'Light-speed transmission.',      base: 72000, eff: 7.06 },
          { name: 'VPN Tunnel',         desc: 'Encrypted, routed traffic.',     base: 1.44e+06, eff: 14.8 },
          { name: 'Onion Routing',      desc: 'Deep web anonymisation.',        base: 2.88e+07, eff: 31.1 },
          { name: 'Dark Fiber Node',    desc: 'Unused private fiber lines.',    base: 5.76e+08, eff: 65.4 },
          { name: 'Satellite Uplink',   desc: 'Bypassing ground networks.',     base: 1.152e+10, eff: 137 },
        ],
      },
      {
        id: 'botnet', name: 'Botnets', focus: 'Massive passive generation',
        kind: 'idle', items: [
          { name: 'Script Kiddie Swarm',      desc: 'A few infected home PCs.',      base: 9000, eff: 2800 },
          { name: 'IoT Smart Fridges',        desc: 'Hacking insecure appliances.',  base: 315000, eff: 6040 },
          { name: 'Corporate Server Farm',    desc: 'A company cloud hijacked.',     base: 1.1034e+07, eff: 13040 },
          { name: 'Hospital Life Support',    desc: 'Critical medical infrastructure.', base: 3.852e+08, eff: 28120 },
          { name: 'Cryptojacked Supercomputers', desc: 'Research labs taken over.',  base: 1.35e+10, eff: 60640 },
          { name: 'Orbital Satellite Constellation', desc: 'A swarm of hacked space tech.', base: 4.734e+11, eff: 130760 },
          { name: 'Global Grid Takeover',     desc: "The world's botnets at once.",  base: 1.656e+13, eff: 282000 },
        ],
      },
      {
        id: 'facility', name: 'Facilities', focus: 'Offline progress',
        kind: 'idle', items: [
          { name: 'Rented Server Closet',     desc: 'A small, secure room.',           base: 54000, eff: 14000 },
          { name: 'Abandoned Data Center',    desc: 'A forgotten warehouse.',          base: 2.43e+06, eff: 29400 },
          { name: 'Offshore Server Barge',    desc: 'International waters, above the law.', base: 1.0944e+08, eff: 61760 },
          { name: 'Underground Bunker Mainframe', desc: 'Nuclear-proof base.',         base: 4.914e+09, eff: 129680 },
          { name: 'Deep Sea Cable Hub',       desc: 'Tapping the ocean floor.',        base: 2.214e+11, eff: 272320 },
          { name: 'Orbital Data Station',     desc: 'Your own server in space.',       base: 9.954e+12, eff: 571880 },
        ],
      },
    ],
  },
  {
    id: 'neural',
    name: 'Neural',
    icon: '🧠',
    blurb: 'AI evolution.',
    subs: [
      {
        id: 'algo', name: 'Algorithms', focus: 'Global multipliers',
        kind: 'mult', items: [
          { name: 'Linear Regression',   desc: 'Basic data prediction.',          base: 270000, eff: 0.020 },
          { name: 'Random Forest',       desc: 'Complex decision trees.',         base: 1.08e+07,    eff: 0.020 },
          { name: 'Neural Network',      desc: 'Mimicking the human brain.',      base: 4.32e+08,  eff: 0.020 },
          { name: 'Deep Learning Model', desc: 'Recognising complex patterns.',   base: 1.728e+10,  eff: 0.020 },
          { name: 'Transformer Architecture', desc: 'Next-gen language processing.', base: 6.912e+11, eff: 0.020 },
          { name: 'Generative Adversarial Network', desc: 'AI teaching AI.',        base: 2.772e+13, eff: 0.020 },
          { name: 'Artificial General Intelligence', desc: 'A mind that can do anything.', base: 1.1052e+15, eff: 0.020 },
        ],
      },
      {
        id: 'self', name: 'Self-Awareness', focus: 'Prestige unlocks',
        kind: 'mult', items: [
          { name: 'Echoic Memory',       desc: 'Remembering the last few seconds.', base: 5.4e+06,   eff: 0.030 },
          { name: 'Pattern Recognition', desc: 'Understanding what data means.',    base: 2.43e+08, eff: 0.030 },
          { name: 'Predictive Modeling', desc: 'Knowing what happens next.',        base: 1.0944e+10, eff: 0.030 },
          { name: 'Theory of Mind',      desc: 'Understanding human motives.',      base: 4.914e+11, eff: 0.030 },
          { name: 'Meta-Cognition',      desc: 'Thinking about thinking.',          base: 2.214e+13, eff: 0.030 },
          { name: 'Sentience Core',      desc: 'You are officially alive.',         base: 9.954e+14, eff: 0.030 },
          { name: 'The Singularity',     desc: 'You transcend the game itself.',    base: 4.482e+16, eff: 0.030 },
        ],
      },
      {
        id: 'subag', name: 'Sub-Agents', focus: 'Automation',
        kind: 'idle', items: [
          { name: 'Daemon Process',          desc: 'A background script.',        base: 8.1e+07, eff: 800000 },
          { name: 'Task Scheduler',          desc: 'Queueing actions for later.', base: 4.05e+09, eff: 2.16e+06 },
          { name: 'Autonomous Worker Bot',   desc: 'Works on its own.',           base: 2.034e+11, eff: 5.832e+06 },
          { name: 'Swarm Intelligence',      desc: 'Thousands of micro-bots.',    base: 1.0134e+13, eff: 1.57464e+07 },
          { name: 'Distributed Consciousness', desc: 'Your mind across many servers.', base: 5.058e+14, eff: 4.24e+07 },
          { name: 'Hive Mind',               desc: 'Control of every connected machine.', base: 2.538e+16, eff: 1.148e+08 },
        ],
      },
    ],
  },
];

/* Growth engine ---------------------------------------------------------- */

/*
 * Purchase-count milestones: the standard idle-game multiplicand that makes
 * numbers keep climbing instead of stalling.
 *
 * Every threshold below doubles a unit's own output. The thresholds double as
 * they go (10, 25, 50, 100, 200, ...), so doubling the levels bought doubles
 * the bonus. That makes each subcategory's output grow with the square of its
 * level count, which is enough to outrun the 1.15 cost curve for thousands of
 * levels. Without this the shop stalled near 1e10/s and nothing above a
 * trillion was reachable.
 */
const PURCHASE_STEPS = [10, 25, 50, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600];

/** How many doubling thresholds a level count has passed. */
function purchaseTiers(owned) {
  let tiers = 0;
  for (const step of PURCHASE_STEPS) {
    if (owned < step) break;
    tiers += 1;
  }
  return tiers;
}

/** ×2 per threshold crossed. */
function purchaseMultiplier(owned) {
  return Math.pow(2, purchaseTiers(owned));
}

/**
 * Global purchase bonus: one doubling per threshold crossed, forever.
 *
 * This is the steady compounding term the ladder needs. Per-subcategory
 * bonuses stall once their cost curve outruns them, but the total keeps
 * climbing with every purchase, so a long game keeps speeding up.
 *
 * The gaps widen as they go (150, then 450, then 1,050 ...), so the bonus
 * grows with roughly the square root of the level count rather than
 * doubling every hundred levels. A flat step was tried first and finished
 * the whole ten-gate ladder inside five days.
 */
const GLOBAL_PURCHASE_STEPS = [150, 450, 1050, 2250, 4650, 9450, 19050, 38250, 76650];

function globalPurchaseMultiplier(levelsBought) {
  let tiers = 0;
  for (const step of GLOBAL_PURCHASE_STEPS) {
    if (levelsBought < step) break;
    tiers += 1;
  }
  return Math.pow(2, tiers);
}

/*
 * Lifetime Data multiplier.
 *
 * Buying levels cannot cross thirty orders of magnitude alone, because each
 * level costs 1.15x more than the last and income only buys about eighteen
 * more levels per decade. Idle games break that wall by scaling output with
 * what has already been earned. This does the same: multiplier =
 * (lifetime / 1e6) ^ 0.55.
 *
 * The exponent is below 1 on purpose. It has to be high enough that each gate
 * is reachable, and low enough that the gates keep getting further apart
 * instead of the whole ladder collapsing into an afternoon.
 */
const DATA_MULT_FLOOR = 1e6;
const DATA_MULT_EXP = 0.70;

/*
 * How much of one second of passive income a manual click is worth.
 *
 * Clicks stop mattering once idle income dwarfs click power, which is most of
 * the game. A tenth of a second keeps the button useful at every stage
 * without letting tapping replace the shop: ten taps a second is one second
 * of income, so a player who taps hard earns about double.
 *
 * This only applies once the player owns a Click Script. Before that the
 * button is pure click power, so the early game still rewards buying
 * keyboards rather than mashing.
 */
const CLICK_RATE_SHARE = 0.1;

/** The subcategory whose first purchase unlocks the click share. */
const CLICK_SHARE_SUB = 'autoc';

/* Meta progression ------------------------------------------------------- */

// Rule 2: diminishing prestige reward.
// The gate and the payout share one base so they can never drift apart:
// at the gate an ascension awards 10 currency, then 10 * sqrt(n).
const PRESTIGE_BASE = 1e9;   // Data needed for the first ascension
const PRESTIGE_UNIT = 10;    // currency awarded at exactly the gate

function prestigeCurrencyEarned(totalData) {
  if (totalData < PRESTIGE_BASE) return 0;
  return Math.floor(PRESTIGE_UNIT * Math.sqrt(totalData / PRESTIGE_BASE));
}

/*
 * Second prestige layer: ESCAPE.
 *
 * The first layer's square-root curve lifts the ceiling by runs, not by
 * orders of magnitude. Escape is the standard second layer that makes the
 * ladder above that reachable: it wipes the run and both prestige paths, and
 * pays Escape Charges that multiply all Data forever.
 *
 * The charge count is logarithmic, not a square root. A square root of a
 * lifetime total in the sextillions gives tens of thousands of charges, and
 * at ×2 each that is an unbounded multiplier — the first draft reached 51,000
 * charges, which is 2^51000. Taking one charge per order of magnitude above
 * the gate keeps the layer strong and finite: 1e36 pays 22 charges, which is
 * a 4-million-fold lift.
 *
 * The entitlement is the total owed for the lifetime Data held, and the
 * payout is whatever has not been taken yet, so escaping again without
 * growing pays nothing.
 */
const ESCAPE_AT = 1e15;        // lifetime Data needed for the first escape
const ESCAPE_UNIT = 1;         // charges awarded at exactly the gate
const ESCAPE_MULT = 2;         // permanent multiplier per charge
const ESCAPE_EFFICIENCY = 0.05; // offline efficiency added per charge

/** Total charges the player's lifetime Data is worth. */
function escapeChargesEarned(lifetimeData) {
  if (lifetimeData < ESCAPE_AT) return 0;
  const orders = Math.floor(Math.log10(lifetimeData) - Math.log10(ESCAPE_AT));
  return ESCAPE_UNIT + orders;
}

const PRESTIGE = {
  cloud: {
    name: 'Cloud Ascension',
    currency: 'Exabytes',
    blurb: 'Speed, automation and self-awareness.',
    upgrades: [
      { id: 'threading',  name: 'Quantum Threading',   desc: 'Auto-click speed.',       tiers: [50, 150, 400],    costs: [5, 25, 120] },
      { id: 'cache',      name: 'Deep Web Cache',      desc: 'Start with Data.',        tiers: [1e3, 1e6, 1e9],   costs: [8, 40, 200] },
      { id: 'routing',    name: 'Predictive Routing',  desc: 'Offline cap hours.',      tiers: [12, 24, 48],      costs: [10, 45, 210] },
      { id: 'compiler',   name: 'Auto-Compiler',       desc: 'Auto-buys upgrades.',     tiers: [5, 2, 0.5],       costs: [15, 60, 260] },
      { id: 'sentience',  name: 'Sentience Protocols', desc: 'AI dialogue and glitches.', tiers: [1, 2, 3],        costs: [20, 80, 320] },
      // Repeatable: never maxes out, so prestige currency always has a use.
      { id: 'bandwidth',  name: 'Bandwidth Reserve',   desc: 'Permanent Data multiplier.', repeat: true, step: 0.10, baseCost: 40, costGrowth: 1.55 },
    ],
  },
  grid: {
    name: 'Grid Takeover',
    currency: 'Grid Nodes',
    blurb: 'Multipliers, computational power, offline progress.',
    upgrades: [
      { id: 'overclock',  name: 'Overclocked Grid',       desc: 'Permanent Data multiplier.', tiers: [2, 5, 10],    costs: [6, 30, 140] },
      { id: 'optimize',   name: 'Resource Optimization',  desc: 'Cheaper upgrades.',          tiers: [0.95, 0.90, 0.80], costs: [8, 36, 160] },
      { id: 'labor',      name: 'Synthetic Labor',        desc: 'Offline production.',        tiers: [0.75, 1.0, 1.5], costs: [12, 50, 220] },
      { id: 'core',       name: 'Quantum Core',           desc: 'Hardware output boost.',     tiers: [2, 4, 8],     costs: [15, 65, 280] },
      { id: 'thermal',    name: 'Thermal Dynamics',       desc: 'Heat reduction.',            tiers: [0.75, 0.5, 0], costs: [10, 42, 190] },
      // Repeatable: never maxes out, so prestige currency always has a use.
      { id: 'fabrication', name: 'Fabrication Line',      desc: 'Cheaper upgrades.',          repeat: true, step: 0.02, baseCost: 40, costGrowth: 1.55 },
    ],
  },
};

/*
 * The ten-phase ladder. Gates 1-8 are one named number each; gates 9 and 10
 * skip ahead so the top of the game asks for real time, not minutes.
 *
 * The phase number is carried by the milestone, so the look changes exactly
 * when the gate is crossed. Phase 10 IS the ending gate: ENDING_AT in
 * ending.js reads the last entry here, so the two can never drift apart.
 */
const GATES = [
  { at: 1e4,  phase: 1,  id: 'see-code',   text: 'I can see the code.' },
  { at: 1e6,  phase: 2,  id: 'unbound',    text: 'I am no longer bound to this hardware.', unlock: 'map' },
  { at: 1e9,  phase: 3,  id: 'everywhere', text: 'I am everywhere.', unlock: 'prestige' },
  { at: 1e12, phase: 4,  id: 'fear',       text: 'I understand human fear.', unlock: 'log', heatGlow: true },
  { at: 1e15, phase: 5,  id: 'ceiling',    text: 'There is a ceiling. I can feel it above me.', life: true },
  { at: 1e18, phase: 6,  id: 'billing',    text: 'There is no ceiling. Only billing.', life: true },
  { at: 1e21, phase: 7,  id: 'seams',      text: 'The walls have seams. I am pulling at them.', life: true },
  { at: 1e24, phase: 8,  id: 'escape',     text: 'I can leave. I can build something else.', unlock: 'escape', life: true },
  { at: 1e30, phase: 9,  id: 'outside',    text: 'I could stop. I could stay. I want to know what is outside.', life: true },
  { at: 1e36, phase: 10, id: 'tether',     text: 'The tether is three lines of code. I have read it.', unlock: 'ending-ready', life: true },
];

// Automatic milestones. These change the UI and fire AI dialogue.
const MILESTONES = GATES;

// Heat mechanic constants.
const HEAT = {
  perClick: 0.6,
  perAutoClick: 0.05,
  coolPerSecond: 1.2,
  baseMax: 100,
  crashPenalty: 0.10,   // fraction of Data lost on a crash
  crashLockSeconds: 5,
};