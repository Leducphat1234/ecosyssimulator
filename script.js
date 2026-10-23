(function () {
  'use strict';

  // ---------- Hằng số luật ----------
  const STEPS_PER_DAY = 100;        // số bước mỗi ngày
  const MAX_TICKS_PER_FRAME = 200;  // chặn giật khi tua nhanh
  const INIT_SATIETY = 1;           // điểm no khi sinh ra
  const FOOD_POINTS = 2;            // điểm no của một hạt
  const REPRO_AT = 2;               // đủ điểm này (sau khi trừ cuối ngày) thì đẻ
  const REPRO_COST = 1;             // mẹ mất điểm no khi đẻ (vô tính)
  const MATE_COST = 1;              // mỗi con trong cặp mất điểm no khi sinh sản hữu tính
  const STEP_RATIO = 0.012;         // bước đi = 1.2% cạnh hình vuông
  const VISION_RATIO = 0.3;         // tầm nhìn = 30% cạnh
  const REACH_STEPS = 2;            // "chạm tới hạt" = trong vòng 2 bước đi
  const LOG_MAX = 12;

  const COLORS = { blue: '#2f7bff', red: '#e53935', yellow: '#fbc02d', food: '#2ea44f' };

  const $ = (id) => document.getElementById(id);
  const canvas = $('habitat');
  const ctx = canvas.getContext('2d');

  const state = {
    creatures: [],
    foods: [],
    day: 1,
    tick: 0,
    acc: 0,
    running: false,
    last: 0,
    raf: 0,
    size: 500,
    log: [],
    spoiled: 0,   // số hạt bị đánh hỏng trong ngày
    fed: 0,       // số lần được cho ăn trong ngày
    mode: 'asexual', // chế độ sinh sản đang áp dụng: 'asexual' | 'sexual'
    born: 0       // số con sinh ra bằng sinh sản hữu tính trong ngày
  };

  let S = null; // cài đặt hiện tại

  // ---------- Đọc cài đặt ----------
  function num(id, min, max, fallback) {
    const v = parseFloat($(id).value);
    if (!isFinite(v)) return fallback;
    return Math.min(max, Math.max(min, v));
  }

  function readSettings() {
    return {
      secPerDay: num('secPerDay', 0.1, 600, 5),
      daysPerMonth: Math.round(num('daysPerMonth', 1, 365, 30)),
      size: Math.round(num('size', 200, 900, 500)),
      foodPerDay: Math.round(num('foodPerDay', 0, 1000, 30)),
      yellowToRed: num('yellowToRed', 0, 100, 50) / 100,
      foodCap: Math.round(num('foodCap', 1, 5000, 300)),
      popCap: Math.round(num('popCap', 1, 5000, 1500)),
      repro: $('repro').value === 'sexual' ? 'sexual' : 'asexual',
      litter: Math.round(num('litter', 1, 10, 2)),
      dispersal: num('dispersal', 0, 100, 0) / 100
    };
  }

  function readInit() {
    return {
      blue: Math.round(num('initBlue', 0, 5000, 30)),
      red: Math.round(num('initRed', 0, 5000, 10)),
      yellow: Math.round(num('initYellow', 0, 5000, 10)),
      food: Math.round(num('initFood', 0, 5000, 30))
    };
  }

  // Chế độ hữu tính: sinh vật có ≥ 2 điểm no vào đầu ngày thì muốn sinh sản,
  // nhịn ăn cả ngày để tìm đồng loại cũng đang muốn sinh sản.
  function assignDesires() {
    const sexual = state.mode === 'sexual';
    for (const c of state.creatures) {
      c.wants = sexual && !c.ate && c.satiety >= REPRO_AT - 1e-9;
    }
  }

  function syncMode() {
    if (state.mode !== S.repro) {
      state.mode = S.repro;
      assignDesires();
    }
  }

  function applySettings() {
    S = readSettings();
    syncMode();
    if (state.size !== S.size) {
      const k = S.size / state.size;
      for (const c of state.creatures) { c.x *= k; c.y *= k; }
      for (const f of state.foods) { f.x *= k; f.y *= k; }
      state.size = S.size;
      canvas.width = S.size;
      canvas.height = S.size;
    }
    $('secPerMonth').value = (S.secPerDay * S.daysPerMonth).toFixed(1);
    $('yellowToBlue').value = Math.round((1 - S.yellowToRed) * 100);
    render();
  }

  // ---------- Tạo thế giới ----------
  // Vị trí con mới quanh (x, y). Độ phát tán 0%: sát bố mẹ (±5px).
  // Càng lớn thì càng rải xa, 100%: ngẫu nhiên đều khắp hình vuông (cuộn vòng ở mép).
  function childPos(x, y) {
    const size = state.size;
    const half = Math.max(5, S.dispersal * size);
    const wrap = (v) => ((v % size) + size) % size;
    return {
      x: wrap(x + (Math.random() * 2 - 1) * half),
      y: wrap(y + (Math.random() * 2 - 1) * half)
    };
  }

  function makeCreature(type, x, y) {
    return { type, x, y, satiety: INIT_SATIETY, ate: false, wants: false, angle: Math.random() * Math.PI * 2 };
  }

  function spawnFood(n) {
    const m = 6;
    for (let i = 0; i < n; i++) {
      state.foods.push({
        x: m + Math.random() * (state.size - 2 * m),
        y: m + Math.random() * (state.size - 2 * m)
      });
    }
  }

  function buildWorld() {
    S = readSettings();
    const init = readInit();
    state.size = S.size;
    canvas.width = S.size;
    canvas.height = S.size;
    state.creatures = [];
    state.foods = [];
    state.day = 1;
    state.tick = 0;
    state.acc = 0;
    state.log = [];
    state.spoiled = 0;
    state.fed = 0;
    state.born = 0;
    state.mode = S.repro;
    for (const type of ['blue', 'red', 'yellow']) {
      for (let i = 0; i < init[type]; i++) {
        state.creatures.push(makeCreature(type, Math.random() * S.size, Math.random() * S.size));
      }
    }
    spawnFood(Math.min(init.food, S.foodCap));
    $('secPerMonth').value = (S.secPerDay * S.daysPerMonth).toFixed(1);
    $('yellowToBlue').value = Math.round((1 - S.yellowToRed) * 100);
    addLog('Bắt đầu: ' + counts().blue + ' xanh, ' + counts().red + ' đỏ, ' + counts().yellow +
           ' vàng, ' + state.foods.length + ' hạt.');
    render();
  }

  // ---------- Mô phỏng ----------
  function moveAll() {
    const step = state.size * STEP_RATIO;
    const vis2 = Math.pow(state.size * VISION_RATIO, 2);
    const size = state.size;
    const foods = state.foods;
    const seekers = state.creatures.filter((c) => c.wants);

    for (const c of state.creatures) {
      if (c.ate) continue;

      let best = null;
      let bd = vis2;
      if (c.wants) {
        // đang nhịn ăn: chỉ đi tìm đồng loại cũng đang muốn sinh sản
        for (const o of seekers) {
          if (o === c || o.type !== c.type) continue;
          const dx = o.x - c.x;
          const dy = o.y - c.y;
          const d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = o; }
        }
      } else {
        for (let i = 0; i < foods.length; i++) {
          const dx = foods[i].x - c.x;
          const dy = foods[i].y - c.y;
          const d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = foods[i]; }
        }
      }

      if (best) {
        const d = Math.sqrt(bd);
        if (d <= step) {
          c.x = best.x;
          c.y = best.y;
        } else {
          c.x += (best.x - c.x) / d * step;
          c.y += (best.y - c.y) / d * step;
        }
      } else {
        c.angle += (Math.random() - 0.5) * 0.9;
        c.x += Math.cos(c.angle) * step * 0.6;
        c.y += Math.sin(c.angle) * step * 0.6;
        if (c.x < 0) { c.x = 0; c.angle = Math.PI - c.angle; }
        else if (c.x > size) { c.x = size; c.angle = Math.PI - c.angle; }
        if (c.y < 0) { c.y = 0; c.angle = -c.angle; }
        else if (c.y > size) { c.y = size; c.angle = -c.angle; }
      }
    }
  }

  function feed(c, points) {
    c.satiety += points;
    c.ate = true;
    state.fed++;
  }

  // Vai trò trong một lần tranh chấp. Vàng chọn đỏ hoặc xanh theo xác suất
  // cho riêng lần đó, không đổi màu thật và không nhớ sang lần sau.
  function role(c) {
    if (c.type !== 'yellow') return c.type;
    return Math.random() < S.yellowToRed ? 'red' : 'blue';
  }

  // group: 1 hoặc 2 sinh vật cùng chạm tới một hạt trong bước này
  function resolveContest(group) {
    if (group.length === 1) {
      feed(group[0], FOOD_POINTS);
      return;
    }
    // phân xử đúng 2 con theo vai trò của lần tranh chấp này
    const [a, b] = group;
    const ra = role(a);
    const rb = role(b);
    if (ra === 'red' && rb === 'red') {
      state.spoiled++;               // đỏ - đỏ: đánh nhau, hạt hỏng, không ai được ăn
    } else if (ra === 'red') {
      feed(a, FOOD_POINTS);          // đỏ - xanh: đỏ chiếm hết, xanh vẫn đói
    } else if (rb === 'red') {
      feed(b, FOOD_POINTS);
    } else {
      feed(a, FOOD_POINTS / 2);      // xanh - xanh: chia đôi
      feed(b, FOOD_POINTS / 2);
    }
  }

  function resolveFoods() {
    if (state.foods.length === 0) return;
    const reach = state.size * STEP_RATIO * REACH_STEPS;
    const reach2 = reach * reach;

    const order = state.foods.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }

    const remaining = [];
    for (const f of order) {
      const near = [];
      for (const c of state.creatures) {
        if (c.ate || c.wants) continue;   // đang nhịn ăn để tìm bạn thì không tranh hạt
        const dx = c.x - f.x;
        const dy = c.y - f.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= reach2) near.push({ c, d2 });
      }
      if (near.length === 0) {
        remaining.push(f);
      } else {
        // tối đa 2 con tranh chấp một hạt (2 con tới gần nhất);
        // con thứ 3 trở đi bỏ qua hạt này, vẫn đói và có thể tranh hạt khác
        near.sort((p, q) => p.d2 - q.d2);
        resolveContest(near.slice(0, 2).map((p) => p.c));  // hạt luôn bị tiêu thụ hoặc làm hỏng
      }
    }
    state.foods = remaining;
  }

  function endDay() {
    const survivors = [];
    let died = 0;
    for (const c of state.creatures) {
      c.satiety -= 1;
      c.ate = false;
      if (c.satiety <= 1e-9) died++;
      else survivors.push(c);
    }

    const babies = [];
    for (const c of survivors) {
      if (state.mode === 'asexual' && c.satiety >= REPRO_AT - 1e-9 && survivors.length + babies.length < S.popCap) {
        c.satiety -= REPRO_COST;
        const pos = childPos(c.x, c.y);
        babies.push(makeCreature(c.type, pos.x, pos.y));
      }
    }
    state.creatures = survivors.concat(babies);
    assignDesires();   // ngày mới: ai ≥ 2 điểm no thì muốn sinh sản (chỉ khi ở chế độ hữu tính)

    const room = Math.max(0, S.foodCap - state.foods.length);
    const added = Math.min(S.foodPerDay, room);
    spawnFood(added);

    const n = counts();
    addLog('Ngày ' + state.day + ': +' + (babies.length + state.born) + ' sinh, −' + died + ' chết, ' +
           state.spoiled + ' hạt hỏng. Còn ' + n.blue + ' xanh, ' + n.red + ' đỏ, ' +
           n.yellow + ' vàng, ' + state.foods.length + ' hạt.');

    state.spoiled = 0;
    state.fed = 0;
    state.born = 0;
    state.day++;

    if (state.creatures.length === 0) {
      addLog('Tuyệt chủng, mô phỏng dừng.');
      pause();
    }
  }

  // Hữu tính: hai con cùng loài, cùng đang muốn sinh sản, gặp nhau thì sinh con.
  function resolveMating() {
    if (state.mode !== 'sexual') return;
    const pool = state.creatures.filter((c) => c.wants && !c.ate);
    if (pool.length < 2) return;

    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }

    const reach = state.size * STEP_RATIO * REACH_STEPS;
    const reach2 = reach * reach;
    const babies = [];

    for (const a of pool) {
      if (!a.wants) continue;
      let mate = null;
      let bd = reach2;
      for (const o of pool) {
        if (o === a || !o.wants || o.type !== a.type) continue;
        const dx = o.x - a.x;
        const dy = o.y - a.y;
        const d = dx * dx + dy * dy;
        if (d <= bd) { bd = d; mate = o; }
      }
      if (!mate) continue;

      a.wants = false;
      mate.wants = false;
      a.satiety -= MATE_COST;
      mate.satiety -= MATE_COST;

      const mx = (a.x + mate.x) / 2;
      const my = (a.y + mate.y) / 2;
      for (let k = 0; k < S.litter; k++) {
        if (state.creatures.length + babies.length >= S.popCap) break;
        const pos = childPos(mx, my);
        babies.push(makeCreature(a.type, pos.x, pos.y));
        state.born++;
      }
    }
    for (const b of babies) state.creatures.push(b);
  }

  function stepTick() {
    moveAll();
    resolveMating();
    resolveFoods();
    state.tick++;
    if (state.tick >= STEPS_PER_DAY) {
      state.tick = 0;
      endDay();
    }
  }

  // ---------- Vòng lặp ----------
  function frame(now) {
    if (!state.running) return;
    const dt = Math.min(0.25, (now - state.last) / 1000);
    state.last = now;

    S = readSettings();
    if (S.size !== state.size || S.repro !== state.mode) applySettings();

    state.acc += dt / S.secPerDay * STEPS_PER_DAY;
    let n = Math.floor(state.acc);
    state.acc -= n;
    if (n > MAX_TICKS_PER_FRAME) n = MAX_TICKS_PER_FRAME;
    for (let i = 0; i < n && state.running; i++) stepTick();

    render();
    if (state.running) state.raf = requestAnimationFrame(frame);
  }

  function start() {
    if (state.running || state.creatures.length === 0) return;
    state.running = true;
    state.last = performance.now();
    $('btnStart').textContent = 'Tạm dừng';
    state.raf = requestAnimationFrame(frame);
  }

  function pause() {
    state.running = false;
    cancelAnimationFrame(state.raf);
    $('btnStart').textContent = 'Tiếp tục';
  }

  function skipDay() {
    if (state.creatures.length === 0) return;
    S = readSettings();
    syncMode();
    const d = state.day;
    let guard = 0;
    while (state.day === d && guard++ <= STEPS_PER_DAY) stepTick();
    render();
  }

  // ---------- Hiển thị ----------
  function counts() {
    const n = { blue: 0, red: 0, yellow: 0 };
    for (const c of state.creatures) n[c.type]++;
    return n;
  }

  function addLog(text) {
    state.log.unshift(text);
    if (state.log.length > LOG_MAX) state.log.pop();
  }

  function render() {
    const size = state.size;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#fbfcfd';
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = COLORS.food;
    for (const f of state.foods) ctx.fillRect(f.x - 3, f.y - 3, 6, 6);

    for (const c of state.creatures) {
      ctx.globalAlpha = c.ate ? 0.4 : 1;
      ctx.fillStyle = COLORS[c.type];
      ctx.beginPath();
      ctx.arc(c.x, c.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      if (c.wants) {                 // viền hồng: đang nhịn ăn tìm bạn đời
        ctx.strokeStyle = '#d81b60';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 7.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    const n = counts();
    const values = { blue: n.blue, red: n.red, yellow: n.yellow, food: state.foods.length };
    const max = Math.max(1, values.blue, values.red, values.yellow, values.food);
    for (const k of Object.keys(values)) {
      $('v-' + k).textContent = values[k];
      $('bar-' + k).style.height = (values[k] / max * 100) + '%';
    }

    const dpm = S ? S.daysPerMonth : 30;
    const month = Math.floor((state.day - 1) / dpm) + 1;
    const dayInMonth = ((state.day - 1) % dpm) + 1;
    $('clock').textContent = 'Tháng ' + month + ' · Ngày ' + dayInMonth + '/' + dpm;
    $('total').textContent = 'Tổng: ngày ' + state.day;
    $('dayFill').style.width = (state.tick / STEPS_PER_DAY * 100) + '%';

    $('log').innerHTML = state.log.map((t) => '<li>' + t + '</li>').join('');
  }

  // ---------- Sự kiện ----------
  $('btnStart').addEventListener('click', () => (state.running ? pause() : start()));
  $('btnNext').addEventListener('click', skipDay);
  $('btnReset').addEventListener('click', () => {
    pause();
    buildWorld();
    $('btnStart').textContent = 'Bắt đầu';
  });

  const liveInputs = ['secPerDay', 'daysPerMonth', 'size', 'foodPerDay', 'yellowToRed', 'foodCap', 'popCap', 'litter', 'dispersal'];
  for (const id of liveInputs) $(id).addEventListener('input', applySettings);
  $('repro').addEventListener('change', applySettings);

  buildWorld();
})();