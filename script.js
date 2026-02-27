const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const timerEl = document.getElementById("timer");
const levelEl = document.getElementById("level");
const xpEl = document.getElementById("xp");
const hpEl = document.getElementById("hp");
const messageEl = document.getElementById("message");
const restartBtn = document.getElementById("restartBtn");
const levelUpModal = document.getElementById("levelUpModal");
const upgradeOptionsEl = document.getElementById("upgradeOptions");
const joystick = document.getElementById("joystick");
const stick = document.getElementById("stick");

const TOTAL_TIME = 300;
const keys = new Set();

const player = {
  x: canvas.width / 2,
  y: canvas.height / 2,
  radius: 14,
  speed: 220,
  attackDamage: 1,
  attackRange: 220,
  attackCooldown: 0.45,
  projectileSpeed: 540,
  projectileCount: 1,
  lightningChance: 0,
  lightningDamage: 1,
  lightningChains: 1,
  fireChance: 0,
  fireBonusDamage: 1,
  fireExplosionRadius: 80,
  fireExplosionDamage: 1,
};

const state = {
  running: false,
  pausedForLevelUp: false,
  gameTime: 0,
  spawnAccumulator: 0,
  attackAccumulator: 0,
  level: 1,
  xp: 0,
  xpToNext: 8,
  bossSpawned: new Set(),
};

const enemies = [];
const projectiles = [];
const xpOrbs = [];
const effects = [];

const upgrades = [
  { name: "攻击力增强", desc: "攻击伤害 +1", apply: () => (player.attackDamage += 1) },
  {
    name: "攻速提升",
    desc: "攻击间隔 -12%",
    apply: () => (player.attackCooldown = Math.max(0.13, player.attackCooldown * 0.88)),
  },
  { name: "移动加速", desc: "移动速度 +35", apply: () => (player.speed += 35) },
  { name: "射程提升", desc: "攻击距离 +40", apply: () => (player.attackRange += 40) },
  { name: "弹速提升", desc: "子弹速度 +120", apply: () => (player.projectileSpeed += 120) },
  {
    name: "多重弹道",
    desc: "每次额外发射 1 发弹道（最多 +4）",
    apply: () => (player.projectileCount = Math.min(5, player.projectileCount + 1)),
  },
  {
    name: "连锁雷击",
    desc: "攻击有额外概率触发雷电，伤害+1，弹射+1",
    apply: () => {
      player.lightningChance = Math.min(0.6, player.lightningChance + 0.12);
      player.lightningDamage += 1;
      player.lightningChains += 1;
    },
  },
  {
    name: "爆燃弹头",
    desc: "攻击有概率附带火焰；火焰击杀会爆炸",
    apply: () => {
      player.fireChance = Math.min(0.65, player.fireChance + 0.14);
      player.fireBonusDamage += 1;
      player.fireExplosionDamage += 1;
      player.fireExplosionRadius = Math.min(140, player.fireExplosionRadius + 8);
    },
  },
];

let lastTs = performance.now();
let joystickVector = { x: 0, y: 0 };
let joystickActive = false;

const isMobile = window.matchMedia("(pointer: coarse)").matches;
if (isMobile) joystick.classList.remove("hidden");

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function pickSpawnPosition() {
  const side = Math.floor(Math.random() * 4);
  if (side === 0) return { x: rand(0, canvas.width), y: -20 };
  if (side === 1) return { x: canvas.width + 20, y: rand(0, canvas.height) };
  if (side === 2) return { x: rand(0, canvas.width), y: canvas.height + 20 };
  return { x: -20, y: rand(0, canvas.height) };
}

function spawnEnemy(isBoss = false) {
  const pos = pickSpawnPosition();
  const progress = state.gameTime / TOTAL_TIME;
  const strength = 1 + progress * 1.4;
  const hp = isBoss ? Math.floor((24 + progress * 20) * strength) : Math.floor((2 + progress * 7) * strength);
  enemies.push({
    x: pos.x,
    y: pos.y,
    radius: isBoss ? 32 : 12 + Math.floor(progress * 4),
    hp,
    maxHp: hp,
    speed: isBoss ? 78 + progress * 12 : 58 + progress * 58,
    xp: isBoss ? 14 : 2 + Math.floor(progress * 2),
    boss: isBoss,
    ignited: false,
  });
}

function maybeSpawnBoss() {
  for (const point of [150, 270]) {
    if (state.gameTime >= point && !state.bossSpawned.has(point)) {
      spawnEnemy(true);
      state.bossSpawned.add(point);
    }
  }
}

function handleInput(dt) {
  let dx = 0;
  let dy = 0;
  if (keys.has("w")) dy -= 1;
  if (keys.has("s")) dy += 1;
  if (keys.has("a")) dx -= 1;
  if (keys.has("d")) dx += 1;
  dx += joystickVector.x;
  dy += joystickVector.y;
  const len = Math.hypot(dx, dy);
  if (len > 0) {
    player.x = clamp(player.x + (dx / len) * player.speed * dt, player.radius, canvas.width - player.radius);
    player.y = clamp(player.y + (dy / len) * player.speed * dt, player.radius, canvas.height - player.radius);
  }
}

function nearestEnemiesInRange() {
  return enemies
    .map((e) => ({ e, d: Math.hypot(e.x - player.x, e.y - player.y) }))
    .filter((item) => item.d <= player.attackRange)
    .sort((a, b) => a.d - b.d)
    .map((item) => item.e);
}

function spawnProjectile(target, angleOffset = 0) {
  const vx = target.x - player.x;
  const vy = target.y - player.y;
  const len = Math.hypot(vx, vy) || 1;
  const baseAngle = Math.atan2(vy / len, vx / len);
  const angle = baseAngle + angleOffset;
  projectiles.push({
    x: player.x,
    y: player.y,
    vx: Math.cos(angle) * player.projectileSpeed,
    vy: Math.sin(angle) * player.projectileSpeed,
    radius: 4,
    damage: player.attackDamage,
    life: 1.4,
  });
}

function autoAttack(dt) {
  state.attackAccumulator += dt;
  if (state.attackAccumulator < player.attackCooldown) return;

  const targets = nearestEnemiesInRange();
  if (!targets.length) return;

  state.attackAccumulator = 0;
  const primary = targets[0];
  const count = player.projectileCount;
  if (count === 1) {
    spawnProjectile(primary, 0);
    return;
  }

  const spread = Math.min(0.55, 0.12 * (count - 1));
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : i / (count - 1);
    const offset = -spread / 2 + t * spread;
    const target = targets[i] || primary;
    spawnProjectile(target, offset);
  }
}

function dealExplosion(x, y, radius, damage) {
  effects.push({ type: "explosion", x, y, radius, ttl: 0.25 });
  for (let i = enemies.length - 1; i >= 0; i -= 1) {
    const e = enemies[i];
    if (Math.hypot(e.x - x, e.y - y) <= radius + e.radius) {
      damageEnemy(i, damage, "explosion");
    }
  }
}

function nearestEnemyFromPoint(x, y, excludeSet) {
  let bestIndex = -1;
  let bestDist = Infinity;
  for (let i = 0; i < enemies.length; i += 1) {
    if (excludeSet.has(i)) continue;
    const e = enemies[i];
    const d = Math.hypot(e.x - x, e.y - y);
    if (d < bestDist) {
      bestDist = d;
      bestIndex = i;
    }
  }
  return { index: bestIndex, dist: bestDist };
}

function triggerLightning(startIndex) {
  if (startIndex < 0 || startIndex >= enemies.length) return;
  let currentIndex = startIndex;
  const hitSet = new Set([currentIndex]);

  for (let hop = 0; hop < player.lightningChains; hop += 1) {
    const source = enemies[currentIndex];
    if (!source) break;
    const { index: nextIndex, dist } = nearestEnemyFromPoint(source.x, source.y, hitSet);
    if (nextIndex < 0 || dist > 170) break;

    const next = enemies[nextIndex];
    effects.push({
      type: "lightning",
      x1: source.x,
      y1: source.y,
      x2: next.x,
      y2: next.y,
      ttl: 0.12,
    });

    const newIndex = damageEnemy(nextIndex, player.lightningDamage, "lightning");
    if (newIndex === -1) break;
    currentIndex = newIndex;
    hitSet.add(currentIndex);
  }
}

function damageEnemy(index, damage, source = "normal") {
  const e = enemies[index];
  if (!e) return -1;

  e.hp -= damage;
  if (source === "fire") {
    e.ignited = true;
  }

  if (e.hp > 0) return index;

  const dead = enemies[index];
  xpOrbs.push({ x: dead.x, y: dead.y, radius: 7, value: dead.xp });
  enemies.splice(index, 1);

  if (dead.ignited) {
    dealExplosion(dead.x, dead.y, player.fireExplosionRadius, player.fireExplosionDamage);
  }
  return -1;
}

function applyOnHitEffects(enemyIndex) {
  if (enemyIndex < 0 || enemyIndex >= enemies.length) return;

  if (player.lightningChance > 0 && Math.random() < player.lightningChance) {
    const validIndex = damageEnemy(enemyIndex, player.lightningDamage, "lightning");
    effects.push({ type: "lightning", x1: player.x, y1: player.y, x2: enemies[enemyIndex]?.x || player.x, y2: enemies[enemyIndex]?.y || player.y, ttl: 0.1 });
    if (validIndex !== -1) {
      triggerLightning(validIndex);
    }
  }

  if (enemyIndex >= 0 && enemyIndex < enemies.length && player.fireChance > 0 && Math.random() < player.fireChance) {
    damageEnemy(enemyIndex, player.fireBonusDamage, "fire");
    effects.push({ type: "burn", x: enemies[enemyIndex]?.x || player.x, y: enemies[enemyIndex]?.y || player.y, ttl: 0.12 });
  }
}

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i -= 1) {
    const p = projectiles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;

    let hitEnemyIndex = -1;
    for (let j = enemies.length - 1; j >= 0; j -= 1) {
      const e = enemies[j];
      if (Math.hypot(p.x - e.x, p.y - e.y) <= p.radius + e.radius) {
        damageEnemy(j, p.damage, "normal");
        hitEnemyIndex = j;
        break;
      }
    }

    if (hitEnemyIndex !== -1) {
      applyOnHitEffects(Math.min(hitEnemyIndex, enemies.length - 1));
      projectiles.splice(i, 1);
      continue;
    }

    if (p.life <= 0 || p.x < -20 || p.x > canvas.width + 20 || p.y < -20 || p.y > canvas.height + 20) {
      projectiles.splice(i, 1);
    }
  }
}

function die() {
  state.running = false;
  messageEl.textContent = "你阵亡了，游戏结束";
  messageEl.classList.remove("hidden");
  restartBtn.classList.remove("hidden");
}

function updateEnemies(dt) {
  for (const e of enemies) {
    const vx = player.x - e.x;
    const vy = player.y - e.y;
    const len = Math.hypot(vx, vy) || 1;
    e.x += (vx / len) * e.speed * dt;
    e.y += (vy / len) * e.speed * dt;
    if (Math.hypot(e.x - player.x, e.y - player.y) <= e.radius + player.radius) {
      die();
      return;
    }
  }
}

function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i -= 1) {
    effects[i].ttl -= dt;
    if (effects[i].ttl <= 0) {
      effects.splice(i, 1);
    }
  }
}

function openLevelUp() {
  state.pausedForLevelUp = true;
  levelUpModal.classList.remove("hidden");
  upgradeOptionsEl.innerHTML = "";
  const options = [...upgrades].sort(() => Math.random() - 0.5).slice(0, 3);
  for (const upgrade of options) {
    const btn = document.createElement("button");
    btn.className = "option";
    btn.innerHTML = `<h3>${upgrade.name}</h3><p>${upgrade.desc}</p>`;
    btn.addEventListener("click", () => {
      upgrade.apply();
      state.pausedForLevelUp = false;
      levelUpModal.classList.add("hidden");
      refreshHud();
    });
    upgradeOptionsEl.appendChild(btn);
  }
}

function tryLevelUp() {
  while (state.xp >= state.xpToNext) {
    state.xp -= state.xpToNext;
    state.level += 1;
    state.xpToNext = Math.floor(state.xpToNext * 1.28 + 3);
    openLevelUp();
  }
}

function updateXpOrbs(dt) {
  for (let i = xpOrbs.length - 1; i >= 0; i -= 1) {
    const orb = xpOrbs[i];
    const d = Math.hypot(player.x - orb.x, player.y - orb.y);
    if (d < 120) {
      const vx = player.x - orb.x;
      const vy = player.y - orb.y;
      const len = Math.hypot(vx, vy) || 1;
      const speed = 160 + (120 - Math.min(120, d)) * 2;
      orb.x += (vx / len) * speed * dt;
      orb.y += (vy / len) * speed * dt;
    }
    if (d <= player.radius + orb.radius + 2) {
      state.xp += orb.value;
      xpOrbs.splice(i, 1);
      tryLevelUp();
    }
  }
}

function win() {
  state.running = false;
  messageEl.textContent = "生存成功！你坚持了 5 分钟";
  messageEl.classList.remove("hidden");
  restartBtn.classList.remove("hidden");
}

function refreshHud() {
  const remain = Math.max(0, TOTAL_TIME - state.gameTime);
  timerEl.textContent = `${String(Math.floor(remain / 60)).padStart(2, "0")}:${String(Math.floor(remain % 60)).padStart(2, "0")}`;
  levelEl.textContent = state.level;
  xpEl.textContent = `${state.xp} / ${state.xpToNext}`;
  hpEl.textContent = "1";
}

function initGame() {
  player.x = canvas.width / 2;
  player.y = canvas.height / 2;
  player.speed = 220;
  player.attackDamage = 1;
  player.attackRange = 220;
  player.attackCooldown = 0.45;
  player.projectileSpeed = 540;
  player.projectileCount = 1;
  player.lightningChance = 0;
  player.lightningDamage = 1;
  player.lightningChains = 1;
  player.fireChance = 0;
  player.fireBonusDamage = 1;
  player.fireExplosionRadius = 80;
  player.fireExplosionDamage = 1;

  state.running = true;
  state.pausedForLevelUp = false;
  state.gameTime = 0;
  state.spawnAccumulator = 0;
  state.attackAccumulator = 0;
  state.level = 1;
  state.xp = 0;
  state.xpToNext = 8;
  state.bossSpawned.clear();

  enemies.length = 0;
  projectiles.length = 0;
  xpOrbs.length = 0;
  effects.length = 0;

  messageEl.classList.add("hidden");
  restartBtn.classList.add("hidden");
  levelUpModal.classList.add("hidden");
  resetJoystick();
  refreshHud();
}

function update(dt) {
  if (!state.running || state.pausedForLevelUp) return;
  state.gameTime += dt;
  if (state.gameTime >= TOTAL_TIME) return win();

  state.spawnAccumulator += dt;
  const spawnInterval = Math.max(0.2, 0.78 - state.gameTime * 0.0016);
  while (state.spawnAccumulator >= spawnInterval) {
    state.spawnAccumulator -= spawnInterval;
    spawnEnemy(false);
  }

  maybeSpawnBoss();
  handleInput(dt);
  autoAttack(dt);
  updateProjectiles(dt);
  updateEnemies(dt);
  updateXpOrbs(dt);
  updateEffects(dt);
  refreshHud();
}

function drawEntity(x, y, radius, color) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawGrid() {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  for (let x = 0; x < canvas.width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawEffects() {
  for (const ef of effects) {
    if (ef.type === "lightning") {
      ctx.strokeStyle = "rgba(120,190,255,0.95)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ef.x1, ef.y1);
      ctx.lineTo(ef.x2, ef.y2);
      ctx.stroke();
    } else if (ef.type === "explosion") {
      ctx.beginPath();
      ctx.arc(ef.x, ef.y, ef.radius, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,130,40,0.22)";
      ctx.fill();
    } else if (ef.type === "burn") {
      drawEntity(ef.x, ef.y, 8, "rgba(255,95,45,0.8)");
    }
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();
  xpOrbs.forEach((orb) => drawEntity(orb.x, orb.y, orb.radius, "#53ffd0"));
  projectiles.forEach((p) => drawEntity(p.x, p.y, p.radius, "#ffe07e"));

  for (const e of enemies) {
    const color = e.boss ? "#ff4d6d" : e.ignited ? "#ff9d4d" : "#ff8f7e";
    drawEntity(e.x, e.y, e.radius, color);
    if (e.boss) {
      const w = 50;
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(e.x - w / 2, e.y - e.radius - 12, w, 6);
      ctx.fillStyle = "#66ff85";
      ctx.fillRect(e.x - w / 2, e.y - e.radius - 12, w * (e.hp / e.maxHp), 6);
    }
  }

  drawEffects();
  drawEntity(player.x, player.y, player.radius, "#7db4ff");
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.attackRange, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(125,180,255,0.12)";
  ctx.stroke();
}

function gameLoop(ts) {
  const dt = Math.min(0.033, (ts - lastTs) / 1000);
  lastTs = ts;
  update(dt);
  draw();
  requestAnimationFrame(gameLoop);
}

window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if (["w", "a", "s", "d"].includes(key)) {
    keys.add(key);
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

function setJoystickPosition(clientX, clientY) {
  const rect = joystick.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let dx = clientX - cx;
  let dy = clientY - cy;
  const max = rect.width * 0.35;
  const len = Math.hypot(dx, dy);
  if (len > max) {
    dx = (dx / len) * max;
    dy = (dy / len) * max;
  }
  stick.style.left = `${rect.width / 2 - 20 + dx}px`;
  stick.style.top = `${rect.height / 2 - 20 + dy}px`;
  joystickVector = { x: dx / max, y: dy / max };
}

function resetJoystick() {
  stick.style.left = "40px";
  stick.style.top = "40px";
  joystickVector = { x: 0, y: 0 };
}

joystick.addEventListener("pointerdown", (e) => {
  joystickActive = true;
  joystick.setPointerCapture(e.pointerId);
  setJoystickPosition(e.clientX, e.clientY);
});
joystick.addEventListener("pointermove", (e) => joystickActive && setJoystickPosition(e.clientX, e.clientY));
joystick.addEventListener("pointerup", () => {
  joystickActive = false;
  resetJoystick();
});
joystick.addEventListener("pointercancel", () => {
  joystickActive = false;
  resetJoystick();
});

restartBtn.addEventListener("click", initGame);
messageEl.textContent = "点击“开始 / 重新开始”即可试玩";
messageEl.classList.remove("hidden");
restartBtn.classList.remove("hidden");
refreshHud();
requestAnimationFrame(gameLoop);
