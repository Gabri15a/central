/* Cockpit \u00b7 ClimaRio BI
   Roda no iBooks (livro offline) e no Safari (app web da Central) do iPad 2, iOS 9.3.5.
   Somente ES5: nada de let/const, arrow, template, fetch, Intl, Promise.
   Os dados ficam no localStorage, so neste iPad. Abas extras (ex.: Monitor) entram
   por window.cockpitRegistrar e usam os utilitarios de window.cockpitUtil. */
(function () {
  'use strict';

  var VERSAO = '1.6';
  var LS = 'cockpit.v1';
  var TODAS_ABAS = ['monitor', 'agora', 'ritmo', 'quadro', 'foco'];
  var ABAS = [];
  var EXTRAS = {};
  window.cockpitRegistrar = function (nome, obj) { EXTRAS[nome] = obj; };
  var DIAS = ['domingo', 'segunda-feira', 'ter\u00e7a-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 's\u00e1bado'];
  var DC = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 's\u00e1b'];
  var MESES = ['janeiro', 'fevereiro', 'mar\u00e7o', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var TIPO_ROTULO = { nacional: 'nacional', estadual: 'estadual RJ', municipal: 'Niter\u00f3i', facultativo: 'facultativo' };

  /* ================= utilidades ================= */
  function $(id) { return document.getElementById(id); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function html(id, s) { var el = $(id); if (el) { el.innerHTML = s; } }
  function txt(id, s) { var el = $(id); if (el && el.textContent !== s) { el.textContent = s; } }
  function classe(el, c, on) {
    if (!el) { return; }
    var atual = ' ' + el.className + ' ';
    var tem = atual.indexOf(' ' + c + ' ') >= 0;
    if (on && !tem) { el.className = (el.className ? el.className + ' ' : '') + c; }
    if (!on && tem) { el.className = atual.replace(' ' + c + ' ', ' ').replace(/^\s+|\s+$/g, ''); }
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function agoraMs() { return new Date().getTime(); }
  function plural(n, um, varios) { return n === 1 ? um : varios; }

  /* n\u00fameros no padr\u00e3o brasileiro */
  function grupos(s) {
    var o = '';
    while (s.length > 3) { o = '.' + s.slice(-3) + o; s = s.slice(0, -3); }
    return s + o;
  }
  function num(n, casas) {
    casas = casas || 0;
    var neg = n < 0, f = Math.pow(10, casas), r = Math.round(Math.abs(n) * f);
    var i = Math.floor(r / f), d = r - i * f, s = grupos(String(i));
    if (casas > 0) {
      var ds = String(d);
      while (ds.length < casas) { ds = '0' + ds; }
      s += ',' + ds;
    }
    return (neg && r > 0 ? '-' : '') + s;
  }
  function limpa0(s) { return s.indexOf(',') < 0 ? s : s.replace(/0+$/, '').replace(/,$/, ''); }
  function curto(v) {
    var a = Math.abs(v);
    if (a >= 999.5e6) { return limpa0(num(v / 1e9, 2)) + ' bi'; }
    if (a >= 999.5e3) { return limpa0(num(v / 1e6, a >= 99.95e6 ? 1 : 2)) + ' mi'; }
    if (a >= 999.5) { return limpa0(num(v / 1e3, a >= 99.95e3 ? 0 : 1)) + ' mil'; }
    return num(v, 0);
  }
  function rs(v) { return 'R$ ' + curto(v); }
  function rsCheio(v) { return 'R$ ' + num(v, 0); }
  function pct(x) { return num(x * 100, 0) + '%'; }
  function fDias(x) { return Math.abs(x - Math.round(x)) < 0.001 ? num(x, 0) : num(x, 1); }
  function minTxt(min) {
    if (min < 60) { return min + ' min'; }
    var h = Math.floor(min / 60), m = min % 60;
    return h + 'h' + (m ? pad2(m) : '');
  }

  /* datas */
  function chave(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function deChave(k) { var p = k.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function ddmm(d) { return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1); }
  function hhmm(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function diaDoAno(d) { return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(d.getFullYear(), 0, 1)) / 864e5) + 1; }
  function anoBissexto(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function semanaISO(d) {
    var t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    t.setDate(t.getDate() - ((t.getDay() + 6) % 7) + 3);
    var q = new Date(t.getFullYear(), 0, 4);
    q.setDate(q.getDate() - ((q.getDay() + 6) % 7) + 3);
    return 1 + Math.round((t - q) / 6048e5);
  }

  /* ================= estado salvo ================= */
  var est = { aba: '', sab: 0, ov: {}, ritmo: {}, ritmoEx: true, quadro: null, quadroEx: true, foco: null, log: {}, dst: '' };
  (function carregar() {
    try {
      var s = window.localStorage ? window.localStorage.getItem(LS) : null;
      if (s) {
        var o = JSON.parse(s);
        for (var k in est) {
          if (est.hasOwnProperty(k) && o && o.hasOwnProperty(k) && o[k] !== undefined && o[k] !== null) { est[k] = o[k]; }
        }
      }
    } catch (e) { /* sem armazenamento: o app funciona, so nao lembra */ }
    if (typeof est.ov !== 'object' || est.ov === null) { est.ov = {}; }
    if (typeof est.ritmo !== 'object' || est.ritmo === null) { est.ritmo = {}; }
    if (typeof est.log !== 'object' || est.log === null) { est.log = {}; }
    if (est.sab !== 0 && est.sab !== 0.5 && est.sab !== 1) { est.sab = 0; }
  })();
  function salvar() {
    try { window.localStorage.setItem(LS, JSON.stringify(est)); } catch (e) { /* ignora */ }
  }

  /* ================= hora certa =================
     O iOS 9 \u00e9 de 2016 e ainda acha que o Brasil tem hor\u00e1rio de ver\u00e3o (acabou em 2019).
     Se o iPad estiver no fuso de S\u00e3o Paulo com hora autom\u00e1tica, ele fica 1h adiantado
     entre outubro e fevereiro. O app detecta e oferece corrigir com um toque. */
  function dstAtivo(d) {
    var y = d.getFullYear(), jan = new Date(y, 0, 1).getTimezoneOffset(), jul = new Date(y, 6, 1).getTimezoneOffset();
    return d.getTimezoneOffset() < Math.max(jan, jul);
  }
  /* Na vers\u00e3o web (window.COCKPIT_UTC_MIN definido) mostra sempre a hora de Bras\u00edlia calculada do rel\u00f3gio do iPad,
     sem depender do fuso desatualizado do iOS 9. No livro, segue a escolha feita no aviso do hor\u00e1rio de ver\u00e3o. */
  function corr(d) {
    if (typeof window.COCKPIT_UTC_MIN === 'number') { return new Date(d.getTime() + (window.COCKPIT_UTC_MIN + d.getTimezoneOffset()) * 60000); }
    return est.dst === 'corrigir' && dstAtivo(d) ? new Date(d.getTime() - 36e5) : d;
  }
  function agora() { return corr(new Date()); }

  /* ================= feriados (nacionais + RJ + Niter\u00f3i) ================= */
  function pascoa(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    var f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    var l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    var mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, mes - 1, dia);
  }
  var cacheFer = {};
  function feriadosAno(y) {
    if (cacheFer[y]) { return cacheFer[y]; }
    var f = {}, p = pascoa(y);
    function fx(m, d, nome, tipo) { f[chave(new Date(y, m - 1, d))] = { nome: nome, tipo: tipo }; }
    function rel(delta, nome, tipo) { f[chave(new Date(y, p.getMonth(), p.getDate() + delta))] = { nome: nome, tipo: tipo }; }
    fx(1, 1, 'Confraterniza\u00e7\u00e3o Universal', 'nacional');
    rel(-48, 'Carnaval (segunda)', 'facultativo');
    rel(-47, 'Carnaval', 'estadual');
    rel(-46, 'Quarta-feira de Cinzas', 'facultativo');
    rel(-2, 'Sexta-feira Santa', 'nacional');
    fx(4, 21, 'Tiradentes', 'nacional');
    fx(4, 23, 'S\u00e3o Jorge', 'estadual');
    fx(5, 1, 'Dia do Trabalho', 'nacional');
    rel(60, 'Corpus Christi', y >= 2026 ? 'estadual' : 'facultativo');
    fx(9, 7, 'Independ\u00eancia', 'nacional');
    fx(10, 12, 'Nossa Senhora Aparecida', 'nacional');
    fx(11, 2, 'Finados', 'nacional');
    fx(11, 15, 'Proclama\u00e7\u00e3o da Rep\u00fablica', 'nacional');
    fx(11, 20, 'Consci\u00eancia Negra', 'nacional');
    fx(11, 22, 'Anivers\u00e1rio de Niter\u00f3i', 'municipal');
    fx(12, 24, 'V\u00e9spera de Natal', 'facultativo');
    fx(12, 25, 'Natal', 'nacional');
    fx(12, 31, 'V\u00e9spera de Ano-Novo', 'facultativo');
    cacheFer[y] = f;
    return f;
  }
  function feriado(d) { return feriadosAno(d.getFullYear())[chave(d)] || null; }

  /* ================= dias \u00fateis ================= */
  function padraoUtil(d) {
    var dow = d.getDay(), f = feriado(d);
    if (dow === 0) { return false; }
    if (dow === 6 && est.sab === 0) { return false; }
    if (f && f.tipo !== 'facultativo') { return false; }
    return true;
  }
  function ehUtil(d) {
    var o = est.ov[chave(d)];
    if (o === 'u') { return true; }
    if (o === 'f') { return false; }
    return padraoUtil(d);
  }
  function peso(d) {
    if (!ehUtil(d)) { return 0; }
    if (d.getDay() === 6 && est.sab > 0 && !est.ov[chave(d)]) { return est.sab; }
    return 1;
  }
  function alternarDia(k) {
    var d = deChave(k), novo = !ehUtil(d);
    if (novo === padraoUtil(d)) { delete est.ov[k]; } else { est.ov[k] = novo ? 'u' : 'f'; }
    salvar();
  }
  /* soma os dias \u00fateis do m\u00eas; "ate" conta at\u00e9 a data de refer\u00eancia (inclusive ou n\u00e3o) */
  function infoMes(y, m, ref, incluiRef) {
    var n = new Date(y, m + 1, 0).getDate(), kRef = ref ? chave(ref) : '';
    var r = { tot: 0, ate: 0, ult: null, fer: [], n: n, ed: 0, ferUteis: 0 };
    for (var dia = 1; dia <= n; dia++) {
      var d = new Date(y, m, dia), k = chave(d), w = peso(d), f = feriado(d);
      r.tot += w;
      if (w > 0) { r.ult = d; }
      if (f) {
        r.fer.push({ d: d, f: f });
        if (f.tipo !== 'facultativo' && d.getDay() !== 0 && !(d.getDay() === 6 && est.sab === 0)) { r.ferUteis++; }
      }
      if (est.ov[k]) { r.ed++; }
      if (kRef && (k < kRef || (k === kRef && incluiRef))) { r.ate += w; }
    }
    return r;
  }
  function proximoFeriado(ref) {
    for (var i = 1; i <= 400; i++) {
      var d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + i), f = feriado(d);
      if (f && f.tipo !== 'facultativo') { return { d: d, f: f, em: i }; }
    }
    return null;
  }

  /* ================= campos digitados ================= */
  function valor(v) {
    if (!v || !v.t) { return 0; }
    var n = parseFloat(String(v.t).replace(',', '.'));
    return isNaN(n) ? 0 : n * (v.m || 1);
  }
  function digitado(v) {
    var t = (v && v.t) || '';
    if (t === '') { return ''; }
    var p = t.split(','), ip = p[0] === '' ? '0' : p[0].replace(/^0+(?=\d)/, '');
    var s = grupos(ip) + (p.length > 1 ? ',' + p[1] : '');
    if (v.m === 1e3) { s += ' mil'; } else if (v.m === 1e6) { s += ' mi'; }
    return s;
  }

  var CAMPOS = {
    ritmo: { meta: { rs: true }, real: { rs: true } },
    quadro: {
      fat: { rs: true }, sai: { rs: true }, vend: { inteiro: true }, apoio: { inteiro: true },
      pV: { rs: true, par: 250000 }, pC: { rs: true, par: 170000 }, pA: { rs: true, par: 270000 }
    }
  };
  var ativo = { ritmo: 'meta', quadro: 'fat' };

  function mesKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1); }
  var EX_RITMO = { meta: { t: '2,5', m: 1e6 }, real: { t: '1,92', m: 1e6 }, ate: 'ontem' };
  function dadosRitmo() {
    if (est.ritmoEx) { return EX_RITMO; }
    var k = mesKey(agora());
    if (!est.ritmo[k]) {
      est.ritmo[k] = { meta: { t: '', m: 1 }, real: { t: '', m: 1 }, ate: 'ontem' };
      var ks = [];
      for (var x in est.ritmo) { if (est.ritmo.hasOwnProperty(x)) { ks.push(x); } }
      ks.sort();
      while (ks.length > 13) { delete est.ritmo[ks.shift()]; }
    }
    return est.ritmo[k];
  }
  var EX_QUADRO = {
    fat: { t: '3', m: 1e6 }, sai: { t: '1,2', m: 1e6 }, vend: { t: '13', m: 1 }, apoio: { t: '8', m: 1 },
    pV: { t: '250', m: 1e3 }, pC: { t: '170', m: 1e3 }, pA: { t: '270', m: 1e3 }
  };
  function quadroVazio() {
    return {
      fat: { t: '', m: 1 }, sai: { t: '', m: 1 }, vend: { t: '', m: 1 }, apoio: { t: '', m: 1 },
      pV: { t: '250', m: 1e3 }, pC: { t: '170', m: 1e3 }, pA: { t: '270', m: 1e3 }
    };
  }
  function dadosQuadro() {
    if (est.quadroEx) { return EX_QUADRO; }
    if (!est.quadro || typeof est.quadro !== 'object') { est.quadro = quadroVazio(); }
    return est.quadro;
  }
  function objCampos(pg) { return pg === 'ritmo' ? dadosRitmo() : dadosQuadro(); }

  /* ================= teclado num\u00e9rico pr\u00f3prio ================= */
  var TECLAS = [['7', '8', '9', 'back'], ['4', '5', '6', 'C'], ['1', '2', '3', 'mil'], [',', '0', '00', 'mi']];
  var ICONE_BACK = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24" viewBox="0 0 32 24">' +
    '<path d="M11 2h17a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H11L2 12z" fill="none" stroke="#7fc4ff" stroke-width="2" stroke-linejoin="round"/>' +
    '<path d="M15 8l8 8M23 8l-8 8" stroke="#7fc4ff" stroke-width="2" stroke-linecap="round"/></svg>';
  function montarTeclado(id) {
    var s = '';
    for (var r = 0; r < 4; r++) {
      for (var c = 0; c < 4; c++) {
        var k = TECLAS[r][c], rot = k === 'back' ? ICONE_BACK : esc(k);
        var cls = 'tk' + (k === 'back' || k === 'C' ? ' fn' : '') + (k === ',' || k === 'mil' || k === 'mi' ? ' un' : '');
        s += '<div class="' + cls + '" data-act="tecla" data-arg="' + esc(k) + '" style="left:' + (c * 94) + 'px;top:' + (r * 76) + 'px">' + rot + '</div>';
      }
    }
    html(id, s);
  }
  function tecla(k) {
    var pg = est.aba;
    if (pg !== 'ritmo' && pg !== 'quadro') { return; }
    if (pg === 'ritmo' && est.ritmoEx) { est.ritmoEx = false; dadosRitmo(); }
    if (pg === 'quadro' && est.quadroEx) { est.quadroEx = false; est.quadro = quadroVazio(); }
    var nome = ativo[pg], def = CAMPOS[pg][nome], obj = objCampos(pg);
    var v = obj[nome] || { t: '', m: 1 }, t = v.t || '', m = v.m || 1;
    if (k === 'C') { t = ''; m = 1; }
    else if (k === 'back') { if (m !== 1) { m = 1; } else { t = t.slice(0, -1); } }
    else if (k === ',') {
      if (def.inteiro) { return; }
      if (m !== 1) { t = ''; m = 1; }
      if (t.indexOf(',') < 0) { t = (t === '' ? '0' : t) + ','; }
    } else if (k === 'mil' || k === 'mi') {
      if (def.inteiro || t === '' || valor({ t: t, m: 1 }) === 0) { return; }
      if (t.charAt(t.length - 1) === ',') { t = t.slice(0, -1); }
      m = k === 'mil' ? 1e3 : 1e6;
    } else {
      if (m !== 1) { t = ''; m = 1; }
      var p = t.indexOf(',');
      if (p >= 0 && (t.length - p - 1) + k.length > 2) { return; }
      if (t.replace(',', '').length + k.length > (def.inteiro ? 4 : 12)) { return; }
      t = (t === '0' ? '' : t) + k;
      if (/^0+$/.test(t)) { t = '0'; }
    }
    obj[nome] = { t: t, m: m };
    salvar();
    if (pg === 'ritmo') { renderRitmo(); } else { renderQuadro(); }
  }
  function mostrarCampo(pg, nome) {
    var def = CAMPOS[pg][nome], v = dadosQuadroOuRitmo(pg)[nome] || { t: '', m: 1 };
    var d = digitado(v), val = valor(v), sub = '';
    var corpo = (def.rs ? '<span class="cur">R$</span>' : '') +
      (d === '' ? '<span class="vz">' + (def.par ? esc(curto(def.par)) : '0') + '</span>' : esc(d)) +
      '<span class="cursor"></span>';
    html('v-' + nome, corpo);
    classe($('f-' + nome), 'on', ativo[pg] === nome);
    if (!$('s-' + nome)) { return; }
    if (d === '') { sub = 'toque aqui e digite'; }
    else if (def.inteiro) { sub = plural(Math.round(val), 'pessoa', 'pessoas'); }
    else if (v.m !== 1) { sub = '= ' + rsCheio(val); }
    else if (val >= 1000) { sub = '= ' + rs(val); }
    else { sub = 'use mil ou mi para n\u00fameros grandes'; }
    txt('s-' + nome, sub);
  }
  function dadosQuadroOuRitmo(pg) { return pg === 'ritmo' ? dadosRitmo() : dadosQuadro(); }
  function atualizarTeclado(pg) {
    var def = CAMPOS[pg][ativo[pg]], kp = $('kp-' + pg);
    if (!kp) { return; }
    var filhos = kp.childNodes;
    for (var i = 0; i < filhos.length; i++) {
      var el = filhos[i];
      if (el.nodeType === 1 && (' ' + el.className + ' ').indexOf(' un ') >= 0) { classe(el, 'off', !!def.inteiro); }
    }
  }

  /* ================= AGORA ================= */
  var vista = null;
  function chip(s) { return '<span class="chip">' + esc(s) + '</span>'; }
  function barra(p, cor) {
    var w = Math.max(0, Math.min(1, p)) * 100;
    return '<div class="tbar"><i style="width:' + w.toFixed(1) + '%' + (cor ? ';background:' + cor : '') + '"></i></div>';
  }
  function renderAgora() {
    var hoje = agora(), y = hoje.getFullYear(), m = hoje.getMonth();
    var im = infoMes(y, m, hoje, true), antes = infoMes(y, m, hoje, false);
    var utilHoje = peso(hoje) > 0, diasAno = anoBissexto(y) ? 366 : 365, doy = diaDoAno(hoje), tri = Math.floor(m / 3);

    txt('relData', DIAS[hoje.getDay()] + ', ' + hoje.getDate() + ' de ' + MESES[m] + ' de ' + y);
    var chips = chip('Semana ' + semanaISO(hoje)) + chip('Dia ' + doy + ' de ' + diasAno) + chip((tri + 1) + '\u00ba trimestre');
    var verao = dstAtivo(new Date()), perguntar = verao && est.dst !== 'corrigir' && est.dst !== 'ok';
    if (verao && est.dst === 'corrigir') {
      chips += '<span class="chip dstOk" data-act="dst" data-arg="desfazer">hora corrigida \u22121h \u00b7 desfazer</span>';
    }
    html('relChips', chips);
    classe($('relChips'), 'esc', perguntar);
    classe($('dstAviso'), 'esc', !perguntar);
    if (perguntar) {
      html('dstAviso', '<div class="dq">O iOS 9 ainda usa o hor\u00e1rio de ver\u00e3o que acabou em 2019. O rel\u00f3gio est\u00e1 1h adiantado?</div>' +
        '<div class="btn dsim" data-act="dst" data-arg="corrigir">Sim, corrigir</div>' +
        '<div class="btn dnao" data-act="dst" data-arg="ok">N\u00e3o, est\u00e1 certo</div>');
    }

    var s1 = '<div class="tl">DIA \u00daTIL</div>' +
      '<div class="tb"><span class="g mono">' + fDias(im.ate) + '</span><span class="p">de ' + fDias(im.tot) + '</span></div>' +
      barra(im.tot > 0 ? im.ate / im.tot : 0) +
      '<div class="ts">' + (utilHoje ? 'hoje conta como dia \u00fatil' : 'hoje \u00e9 folga no calend\u00e1rio') + '</div>';
    html('tDia', s1);

    var restam = im.tot - antes.ate, s2;
    if (restam <= 0) {
      s2 = '<div class="tl">RESTAM NO M\u00caS</div><div class="tb"><span class="g mono">0</span><span class="p">dias \u00fateis</span></div>' +
        '<div class="ts">' + esc(cap(MESES[m])) + ' j\u00e1 fechou.<br/>Bom trabalho!</div>';
    } else {
      s2 = '<div class="tl">RESTAM NO M\u00caS</div>' +
        '<div class="tb"><span class="g mono">' + fDias(restam) + '</span><span class="p">' + plural(restam, 'dia \u00fatil', 'dias \u00fateis') + '</span></div>' +
        '<div class="ts">' + (utilHoje ? 'contando hoje' : 'a partir do pr\u00f3ximo') + '<br/>' +
        (im.ult ? '\u00faltimo: ' + DC[im.ult.getDay()] + ', ' + ddmm(im.ult) : '') + '</div>';
    }
    html('tFalta', s2);

    var pf = proximoFeriado(hoje), s3 = '<div class="tl">PR\u00d3XIMO FERIADO</div>';
    if (pf) {
      var fds = pf.d.getDay() === 0 || pf.d.getDay() === 6;
      s3 += '<div class="tb"><span class="g2 mono">' + ddmm(pf.d) + '</span></div>' +
        '<div class="ts"><b style="color:#f59e0b;font-weight:600">' + esc(pf.f.nome) + '</b><br/>' +
        DC[pf.d.getDay()] + ' \u00b7 ' + (pf.em === 1 ? 'amanh\u00e3' : 'em ' + pf.em + ' dias') + (fds ? ' \u00b7 fim de semana' : '') + '</div>';
    }
    html('tFer', s3);

    var iniTri = new Date(y, tri * 3, 1), fimTri = new Date(y, tri * 3 + 3, 1);
    var diasTri = Math.round((fimTri - iniTri) / 864e5), passTri = Math.round((new Date(y, m, hoje.getDate()) - iniTri) / 864e5) + 1;
    var progs = [
      ['M\u00eas \u00b7 dias \u00fateis', im.tot > 0 ? im.ate / im.tot : 0],
      ['Trimestre \u00b7 dias corridos', passTri / diasTri],
      ['Ano \u00b7 dias corridos', doy / diasAno]
    ];
    var sp = '';
    for (var i = 0; i < progs.length; i++) {
      sp += '<div class="pr"><div class="prl">' + esc(progs[i][0]) + '<b>' + pct(progs[i][1]) + '</b></div>' +
        '<div class="prb"><i style="width:' + (Math.min(1, progs[i][1]) * 100).toFixed(1) + '%"></i></div></div>';
    }
    html('progs', sp);

    // resumo do Ritmo (s\u00f3 com n\u00fameros de verdade, n\u00e3o o exemplo)
    var rr = '<div class="ml">RITMO DO M\u00caS</div>';
    var dr = est.ritmo[mesKey(hoje)];
    if (!est.ritmoEx && dr && valor(dr.meta) > 0) {
      var c = calcRitmo(dr);
      if (c.st === 'batida') { rr += '<div class="mv ciano">Meta batida \u00b7 ' + pct(c.pctReal) + '</div>'; }
      else if (c.proj === null) { rr += '<div class="mv">' + pct(c.pctReal) + ' <small>da meta at\u00e9 agora</small></div>'; }
      else { rr += '<div class="mv ' + c.cor + '">' + pct(c.pctProj) + ' <small>projetado \u00b7 precisa ' + esc(rs(c.precisaDia || 0)) + '/dia</small></div>'; }
    } else {
      rr += '<div class="mv cinza">Toque para lan\u00e7ar a meta</div>';
    }
    html('resRitmo', rr);

    var lg = est.log[chave(hoje)] || [], minHoje = 0;
    for (var j = 0; j < lg.length; j++) { minHoje += lg[j].min; }
    html('resFoco', '<div class="ml">FOCO HOJE</div><div class="mv">' +
      (lg.length ? lg.length + ' ' + plural(lg.length, 'sess\u00e3o', 'sess\u00f5es') + ' <small>\u00b7 ' + minTxt(minHoje) + ' focado</small>' : '<span class="cinza">Nenhuma sess\u00e3o ainda</span>') + '</div>');
  }

  function renderCal() {
    var hoje = agora(), kHoje = chave(hoje);
    if (!vista) { vista = { y: hoje.getFullYear(), m: hoje.getMonth() }; }
    var y = vista.y, m = vista.m, im = infoMes(y, m, hoje, true);
    txt('calTit', cap(MESES[m]) + ' ' + y);
    classe($('calHoje'), 'esc', y === hoje.getFullYear() && m === hoje.getMonth());
    var primeiro = new Date(y, m, 1).getDay(), s = '';
    for (var dia = 1; dia <= im.n; dia++) {
      var cel = primeiro + dia - 1, x = (cel % 7) * 52, yy = Math.floor(cel / 7) * 50;
      var d = new Date(y, m, dia), k = chave(d), w = peso(d), f = feriado(d), cls = 'dia';
      if (w === 0) { cls += (f && f.tipo !== 'facultativo' && !est.ov[k]) ? ' fer' : ''; }
      else { cls += w < 1 ? ' meio' : ' util'; if (k < kHoje) { cls += ' pass'; } }
      if (k === kHoje) { cls += ' hoje'; }
      s += '<div class="' + cls + '" style="left:' + x + 'px;top:' + yy + 'px" data-act="dia" data-arg="' + k + '">' +
        '<span class="n">' + dia + '</span>' +
        (f && f.tipo === 'facultativo' ? '<span class="fac"></span>' : '') +
        (est.ov[k] ? '<span class="ed"></span>' : '') + '</div>';
    }
    html('calGrade', s);

    var conta = fDias(im.tot) + ' ' + plural(im.tot, 'dia \u00fatil', 'dias \u00fateis');
    if (im.ferUteis) { conta += ' \u00b7 ' + im.ferUteis + ' ' + plural(im.ferUteis, 'feriado', 'feriados') + ' em dia de semana'; }
    if (im.ed) { conta += ' \u00b7 ' + im.ed + ' ' + plural(im.ed, 'editado', 'editados'); }
    txt('calConta', conta);

    classe($('sab-0'), 'on', est.sab === 0);
    classe($('sab-05'), 'on', est.sab === 0.5);
    classe($('sab-1'), 'on', est.sab === 1);

    var sf = '', max = 5;
    for (var i = 0; i < im.fer.length && i < max; i++) {
      var it = im.fer[i], fac = it.f.tipo === 'facultativo';
      sf += '<div class="fl' + (fac ? ' fac' : '') + '"><span class="fd">' + ddmm(it.d) + '</span>' +
        DC[it.d.getDay()] + ' \u00b7 ' + esc(it.f.nome) + '<span class="ft">' + esc(TIPO_ROTULO[it.f.tipo]) + (fac ? ' (conta como \u00fatil)' : '') + '</span></div>';
    }
    if (im.fer.length > max) { sf += '<div class="fl vazio">+ ' + (im.fer.length - max) + ' no m\u00eas</div>'; }
    if (!im.fer.length) { sf = '<div class="fl vazio">Nenhum feriado neste m\u00eas.</div>'; }
    html('calFer', sf);
    html('calDica', 'Toque num dia para trocar entre \u00fatil e folga' + (im.ed ? ' \u00b7 <b>&#9701;</b> = editado por voc\u00ea' : '') + '.');
  }

  /* ================= RITMO ================= */
  function calcRitmo(r) {
    var hoje = agora(), im = infoMes(hoje.getFullYear(), hoje.getMonth(), hoje, r.ate === 'hoje');
    var c = { meta: valor(r.meta), real: valor(r.real), D: im.tot, d: im.ate, ult: im.ult };
    c.rest = c.D - c.d;
    c.media = c.d > 0 ? c.real / c.d : null;
    c.proj = c.d > 0 ? c.real / c.d * c.D : null;
    c.pctProj = c.meta > 0 && c.proj !== null ? c.proj / c.meta : null;
    c.pctReal = c.meta > 0 ? c.real / c.meta : null;
    c.falta = c.meta - c.real;
    c.precisaDia = c.rest > 0 ? Math.max(c.falta, 0) / c.rest : null;
    c.ideal = c.D > 0 ? c.meta * c.d / c.D : 0;
    if (c.meta <= 0) { c.st = 'vazio'; c.cor = 'cinza'; }
    else if (c.real >= c.meta) { c.st = 'batida'; c.cor = 'ciano'; }
    else if (c.d <= 0) { c.st = 'inicio'; c.cor = 'cinza'; }
    else if (c.rest <= 0) { c.st = 'fechado'; c.cor = 'vermelho'; }
    else if (c.proj >= c.meta) { c.st = 'ok'; c.cor = 'verde'; }
    else if (c.proj >= 0.95 * c.meta) { c.st = 'atencao'; c.cor = 'ambar'; }
    else { c.st = 'abaixo'; c.cor = 'vermelho'; }
    return c;
  }
  var COR_HEX = { verde: '#4ee892', vermelho: '#ff7a7a', ambar: '#f59e0b', ciano: '#22d3ee', cinza: '#4b6284' };
  var ST_TXT = { vazio: 'SEM META', batida: 'META BATIDA', inicio: 'COME\u00c7O DO M\u00caS', fechado: 'M\u00caS FECHADO', ok: 'NO RITMO', atencao: 'ATEN\u00c7\u00c3O', abaixo: 'ABAIXO DO RITMO' };

  function renderRitmo() {
    var r = dadosRitmo(), hoje = agora(), c = calcRitmo(r);
    txt('rMes', cap(MESES[hoje.getMonth()]) + ' de ' + hoje.getFullYear() + ' \u00b7 ' + fDias(c.D) + ' dias \u00fateis no calend\u00e1rio');
    classe($('rEx'), 'esc', !est.ritmoEx);
    mostrarCampo('ritmo', 'meta');
    mostrarCampo('ritmo', 'real');
    classe($('ate-ontem'), 'on', r.ate !== 'hoje');
    classe($('ate-hoje'), 'on', r.ate === 'hoje');
    atualizarTeclado('ritmo');

    // anel
    var C = 502.65, p = c.pctProj !== null ? c.pctProj : (c.pctReal !== null ? c.pctReal : 0);
    p = Math.max(0, Math.min(1, p));
    var arco = $('rArco');
    arco.style.strokeDashoffset = String(C * (1 - p));
    arco.style.stroke = COR_HEX[c.cor];
    if (c.st === 'vazio') { txt('rPct', '\u2014'); txt('rPctSub', 'SEM META'); }
    else if (c.pctProj !== null && c.st !== 'batida') { txt('rPct', pct(c.pctProj)); txt('rPctSub', 'DA META \u00b7 PROJETADO'); }
    else { txt('rPct', pct(c.pctReal || 0)); txt('rPctSub', 'DA META \u00b7 REALIZADO'); }
    html('rStatus', '<span class="pill ' + c.cor + '">' + ST_TXT[c.st] + '</span>');

    var pj = '';
    if (c.st === 'vazio') {
      pj = '<div class="k1">COMO USAR</div><div class="k3" style="font-size:15px;line-height:22px;margin-top:6px">Toque em <b>Meta do m\u00eas</b> e digite no teclado. Depois toque em <b>Realizado</b>. Para milh\u00f5es, digite 2,5 e toque em <b>mi</b>.</div>';
    } else if (c.st === 'batida') {
      pj = '<div class="k1">REALIZADO</div><div class="k2 mono">' + esc(rs(c.real)) + '</div>' +
        '<div class="k3">passou a meta em ' + esc(rs(c.real - c.meta)) + (c.proj !== null ? ' \u00b7 proje\u00e7\u00e3o ' + esc(rs(c.proj)) : '') + '</div>';
    } else if (c.proj === null) {
      pj = '<div class="k1">PROJE\u00c7\u00c3O DE FECHAMENTO</div><div class="k2 mono cinza">\u2014</div>' +
        '<div class="k3">A proje\u00e7\u00e3o aparece depois do 1\u00ba dia \u00fatil do m\u00eas. Faltam ' + esc(rs(c.falta)) + '.</div>';
    } else {
      pj = '<div class="k1">PROJE\u00c7\u00c3O DE FECHAMENTO</div><div class="k2 mono ' + c.cor + '">' + esc(rs(c.proj)) + '</div>' +
        '<div class="k3">' + (c.proj >= c.meta ? 'sobra ' + esc(rs(c.proj - c.meta)) + ' acima da meta' : 'faltariam ' + esc(rs(c.meta - c.proj)) + ' para a meta') +
        ' no ritmo atual</div>';
    }
    html('rProj', pj);

    // blocos
    var t1 = '<div class="tl">PRECISA POR DIA \u00daTIL</div>', t2 = '<div class="tl">M\u00c9DIA AT\u00c9 AGORA</div>', t3 = '<div class="tl">DIAS \u00daTEIS</div>';
    if (c.st === 'vazio') {
      t1 += '<div class="v mono cinza">\u2014</div>'; t2 += '<div class="v mono cinza">\u2014</div>';
    } else {
      if (c.precisaDia === null) { t1 += '<div class="v mono cinza">\u2014</div><div class="s">n\u00e3o h\u00e1 mais dias \u00fateis no m\u00eas</div>'; }
      else if (c.precisaDia <= 0) { t1 += '<div class="v mono ciano">R$ 0</div><div class="s">a meta j\u00e1 foi batida</div>'; }
      else {
        var dif = c.media ? c.precisaDia / c.media - 1 : null;
        t1 += '<div class="v mono ' + (dif === null ? '' : (dif > 0.05 ? 'vermelho' : 'verde')) + '">' + esc(rs(c.precisaDia)) + '</div>' +
          '<div class="s">nos ' + fDias(c.rest) + ' ' + plural(c.rest, 'dia \u00fatil restante', 'dias \u00fateis restantes') +
          (dif !== null ? '<br/>' + (dif >= 0 ? '+' : '') + num(dif * 100, 0) + '% vs. a m\u00e9dia' : '') + '</div>';
      }
      if (c.media === null) { t2 += '<div class="v mono cinza">\u2014</div><div class="s">ainda sem dia \u00fatil fechado</div>'; }
      else {
        t2 += '<div class="v mono">' + esc(rs(c.media)) + '</div><div class="s">em ' + fDias(c.d) + ' ' + plural(c.d, 'dia \u00fatil', 'dias \u00fateis') +
          '<br/>' + pct(c.pctReal) + ' da meta realizado</div>';
      }
    }
    t3 += '<div class="v mono">' + fDias(c.d) + ' <span style="font-size:15px;color:#8b9dc3">de ' + fDias(c.D) + '</span></div>' +
      '<div class="s">' + (r.ate === 'hoje' ? 'contando hoje' : 'at\u00e9 ontem') + (c.ult ? '<br/>\u00faltimo: ' + DC[c.ult.getDay()] + ', ' + ddmm(c.ult) : '') + '</div>';
    html('rT1', t1); html('rT2', t2); html('rT3', t3);
    html('rGraf', grafRitmo(c));
  }
  function r1(x) { return Math.round(x * 10) / 10; }
  /* eixo com n\u00fameros redondos: passos de 1, 2, 2,5 ou 5 vezes pot\u00eancia de 10, no m\u00e1ximo 7 faixas */
  function escala(topo) {
    if (!(topo > 0)) { return { passo: 1, n: 1, max: 1 }; }
    var base = Math.pow(10, Math.floor(Math.log(topo) / Math.LN10) - 1), mult = [1, 2, 2.5, 5];
    for (var k = 0; k < 40; k++) {
      var passo = mult[k % 4] * base * Math.pow(10, Math.floor(k / 4)), n = Math.ceil(topo / passo - 1e-9);
      if (n <= 7) { return { passo: passo, n: n, max: n * passo }; }
    }
    return { passo: topo / 4, n: 4, max: topo };
  }
  function grafRitmo(c) {
    if (c.st === 'vazio' || c.D <= 0) {
      return '<div class="vazioGraf">O gr\u00e1fico aparece quando houver meta.</div>';
    }
    var W = 544, H = 262, L = 66, R = 14, T = 26, B = 46, pw = W - L - R, ph = H - T - B;
    var esc0 = escala(Math.max(c.meta, c.proj || 0, c.real) * 1.06), ymax = esc0.max;
    function X(i) { return r1(L + (i / c.D) * pw); }
    function Y(v) { return r1(T + ph - (v / ymax) * ph); }
    var s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">';
    for (var k = 0; k <= esc0.n; k++) {
      var v = esc0.passo * k;
      s += '<line class="gl" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/>';
      s += '<text class="gt" x="' + (L - 8) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + esc(curto(v)) + '</text>';
    }
    var passo = c.D > 15 ? 5 : (c.D > 8 ? 3 : 1), yx = T + ph + 16;
    for (var i = 0; i < c.D - passo * 0.5; i += passo) {
      s += '<text class="gt" x="' + X(i) + '" y="' + yx + '" text-anchor="middle">' + i + '</text>';
    }
    s += '<text class="gt" x="' + X(c.D) + '" y="' + yx + '" text-anchor="middle">' + fDias(c.D) + '</text>';
    s += '<text class="gleg" x="' + (W - R) + '" y="' + (H - 4) + '" text-anchor="end">eixo: dias \u00fateis do m\u00eas</text>';
    s += '<line class="gi" x1="' + X(0) + '" y1="' + Y(0) + '" x2="' + X(c.D) + '" y2="' + Y(c.meta) + '"/>';
    s += '<line class="gm" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(c.meta) + '" y2="' + Y(c.meta) + '"/>';
    s += '<text class="gmt" x="' + (L + 6) + '" y="' + (Y(c.meta) - 7) + '">META ' + esc(rs(c.meta)) + '</text>';
    if (c.d > 0 && c.d < c.D) {
      s += '<line class="gh" x1="' + X(c.d) + '" x2="' + X(c.d) + '" y1="' + T + '" y2="' + (T + ph) + '"/>';
      s += '<text class="ght" x="' + X(c.d) + '" y="' + (T - 10) + '" text-anchor="middle">' + (c.d === c.D ? '' : 'agora') + '</text>';
    }
    if (c.d > 0) {
      if (c.rest > 0 && c.real < c.meta) {
        s += '<line class="gn" stroke="' + COR_HEX[c.precisaDia / (c.media || 1) - 1 > 0.05 ? 'vermelho' : 'verde'] + '" x1="' + X(c.d) + '" y1="' + Y(c.real) + '" x2="' + X(c.D) + '" y2="' + Y(c.meta) + '"/>';
      }
      if (c.rest > 0) {
        s += '<line class="gp" x1="' + X(c.d) + '" y1="' + Y(c.real) + '" x2="' + X(c.D) + '" y2="' + Y(c.proj) + '"/>';
        s += '<circle cx="' + X(c.D) + '" cy="' + Y(c.proj) + '" r="4" fill="none" stroke="#22d3ee" stroke-width="2"/>';
      }
      s += '<line class="gr" x1="' + X(0) + '" y1="' + Y(0) + '" x2="' + X(c.d) + '" y2="' + Y(c.real) + '"/>';
      s += '<circle class="gd" cx="' + X(c.d) + '" cy="' + Y(c.real) + '" r="6"/>';
    }
    // legenda (embaixo, \u00e0 esquerda)
    var lx = L - 60, ly = H - 8;
    s += '<line class="gr" x1="' + lx + '" x2="' + (lx + 16) + '" y1="' + ly + '" y2="' + ly + '"/><text class="gleg" x="' + (lx + 22) + '" y="' + (ly + 4) + '">realizado</text>';
    s += '<line class="gp" x1="' + (lx + 96) + '" x2="' + (lx + 112) + '" y1="' + ly + '" y2="' + ly + '"/><text class="gleg" x="' + (lx + 118) + '" y="' + (ly + 4) + '">proje\u00e7\u00e3o</text>';
    s += '<line class="gn" stroke="#4ee892" x1="' + (lx + 188) + '" x2="' + (lx + 204) + '" y1="' + ly + '" y2="' + ly + '"/><text class="gleg" x="' + (lx + 210) + '" y="' + (ly + 4) + '">o que falta</text>';
    s += '</svg>';
    return s;
  }

  /* ================= QUADRO ================= */
  function calcQuadro(q) {
    var r = {
      F: valor(q.fat), S: valor(q.sai), v: Math.round(valor(q.vend)), a: Math.round(valor(q.apoio)),
      pV: valor(q.pV) || CAMPOS.quadro.pV.par, pC: valor(q.pC) || CAMPOS.quadro.pC.par, pA: valor(q.pA) || CAMPOS.quadro.pA.par
    };
    r.t = r.v + r.a;
    r.fv = r.v > 0 ? r.F / r.v : null;
    r.fc = r.t > 0 ? r.F / r.t : null;
    r.sa = r.a > 0 ? r.S / r.a : null;
    r.vMax = Math.floor(r.F / r.pV + 1e-9);
    r.aMin = r.S > 0 ? Math.ceil(r.S / r.pA - 1e-9) : 0;
    r.tMax = Math.floor(r.F / r.pC + 1e-9);
    r.vI = r.v > r.vMax ? Math.max(r.vMax, r.F > 0 ? 1 : 0) : r.v;
    r.aI = Math.max(r.aMin, Math.min(r.a, r.tMax - r.vI));
    r.tI = r.vI + r.aI;
    r.fcI = r.tI > 0 ? r.F / r.tI : null;
    r.ok = r.tI <= r.tMax;
    return r;
  }
  function regua(nome, metaTxt, valTxt, unid, p, alvoPos, cor, dica) {
    return '<div class="rn">' + esc(nome) + '</div><div class="rm">' + esc(metaTxt) + '</div>' +
      '<div class="rv mono ' + cor + '">' + esc(valTxt) + ' <small>' + esc(unid) + '</small></div>' +
      '<div class="rb"><i style="width:' + (Math.max(0, Math.min(1, p)) * 100).toFixed(1) + '%;background:' + COR_HEX[cor === 'cinza' ? 'cinza' : cor] + '"></i>' +
      (alvoPos !== null ? '<em style="left:' + (Math.max(0, Math.min(1, alvoPos)) * 100).toFixed(1) + '%"></em>' : '') + '</div>' +
      '<div class="rh">' + dica + '</div>';
  }
  function delta(n) {
    if (n === 0) { return '<span class="cinza">=</span>'; }
    return n > 0 ? '<span class="verde">+' + n + '</span>' : '<span class="vermelho">-' + (-n) + '</span>';
  }
  function renderQuadro() {
    var q = dadosQuadro(), r = calcQuadro(q), nomes = ['fat', 'sai', 'vend', 'apoio', 'pV', 'pC', 'pA'];
    classe($('qEx'), 'esc', !est.quadroEx);
    for (var i = 0; i < nomes.length; i++) { mostrarCampo('quadro', nomes[i]); }
    atualizarTeclado('quadro');

    if (r.F <= 0) {
      var vazio = '<div class="rn">COMO USAR</div><div class="rh" style="white-space:normal;font-size:14px;line-height:20px;margin-top:8px">' +
        'Digite o faturamento e a sa\u00edda f\u00edsica da loja no m\u00eas, e quantos vendedores e pessoas de apoio ela tem hoje.</div>';
      html('qR1', vazio); html('qR2', ''); html('qR3', '');
      classe($('qR2'), 'esc', true); classe($('qR3'), 'esc', true);
      html('qIdeal', '<div class="qt">QUADRO SUGERIDO PELA R\u00c9GUA</div><div class="qv cinza">Falta o faturamento do m\u00eas.</div>');
    } else {
      classe($('qR2'), 'esc', false); classe($('qR3'), 'esc', false);
      // r\u00e9gua do vendedor
      var corV = r.fv === null ? 'cinza' : (r.fv >= r.pV ? 'verde' : 'vermelho');
      html('qR1', regua('R\u00c9GUA DO VENDEDOR', 'meta \u2265 ' + rs(r.pV) + ' por vendedor',
        r.fv === null ? '\u2014' : rs(r.fv), 'por vendedor', r.fv === null ? 0 : r.fv / (r.pV * 1.5), 1 / 1.5, corV,
        'cabem at\u00e9 <b>' + r.vMax + '</b> ' + plural(r.vMax, 'vendedor', 'vendedores') + ' \u00b7 hoje ' + r.v));
      // r\u00e9gua geral
      var corC = r.fc === null ? 'cinza' : (r.fc >= r.pC ? 'verde' : 'vermelho');
      html('qR2', regua('R\u00c9GUA GERAL', 'meta \u2265 ' + rs(r.pC) + ' por colaborador',
        r.fc === null ? '\u2014' : rs(r.fc), 'por colaborador', r.fc === null ? 0 : r.fc / (r.pC * 1.5), 1 / 1.5, corC,
        'o quadro todo cabe at\u00e9 <b>' + r.tMax + '</b> ' + plural(r.tMax, 'pessoa', 'pessoas') + ' \u00b7 hoje ' + r.t));
      // r\u00e9gua da retaguarda (sa\u00edda f\u00edsica por pessoa de apoio)
      var corA = r.sa === null ? (r.aMin > 0 ? 'vermelho' : 'cinza') : (r.sa <= r.pA ? 'verde' : 'vermelho');
      html('qR3', regua('R\u00c9GUA DA RETAGUARDA', 'teto ' + rs(r.pA) + ' de sa\u00edda f\u00edsica por pessoa',
        r.sa === null ? '\u2014' : rs(r.sa), 'por pessoa de apoio', r.sa === null ? 0 : r.sa / (r.pA * 1.5), 1 / 1.5, corA,
        'pelo f\u00edsico, precisa de pelo menos <b>' + r.aMin + '</b> no apoio \u00b7 hoje ' + r.a));

      var frase = '';
      if (r.vI < r.v) { frase = 'cortar ' + (r.v - r.vI) + ' ' + plural(r.v - r.vI, 'vendedor', 'vendedores'); }
      if (r.aI < r.a) { frase += (frase ? ' e ' : 'cortar ') + (r.a - r.aI) + ' no apoio'; }
      if (r.aI > r.a) { frase += (frase ? ' e ' : '') + 'refor\u00e7ar ' + (r.aI - r.a) + ' no apoio'; }
      frase = frase ? cap(frase) : 'Manter o quadro como est\u00e1';
      var fim;
      if (r.ok) {
        fim = '<span class="verde">\u2192 ' + r.tI + ' ' + plural(r.tI, 'pessoa', 'pessoas') + ', ' + esc(rs(r.fcI || 0)) + ' por colaborador. Dentro das tr\u00eas r\u00e9guas.</span>';
      } else {
        fim = '<span class="ambar">\u2192 ' + r.tI + ' ' + plural(r.tI, 'pessoa', 'pessoas') + '. Mesmo no ideal, fica em ' + esc(rs(r.fcI || 0)) +
          ' por colaborador: o piso do apoio n\u00e3o deixa chegar a ' + esc(rs(r.pC)) + '.</span>';
      }
      var tab = '<div class="qrow cab" style="top:0px"><span class="n"></span><span class="a">HOJE</span><span class="b">IDEAL</span><span class="d">AJUSTE</span></div>' +
        '<div class="qrow" style="top:22px"><span class="n">Vendedores</span><span class="a">' + r.v + '</span><span class="s">\u2192</span><span class="b">' + r.vI + '</span><span class="d">' + delta(r.vI - r.v) + '</span></div>' +
        '<div class="qrow" style="top:50px"><span class="n">Apoio</span><span class="a">' + r.a + '</span><span class="s">\u2192</span><span class="b">' + r.aI + '</span><span class="d">' + delta(r.aI - r.a) + '</span></div>' +
        '<div class="qrow tot" style="top:78px"><span class="n">Total</span><span class="a">' + r.t + '</span><span class="s">\u2192</span><span class="b">' + r.tI + '</span><span class="d">' + delta(r.tI - r.t) + '</span></div>';
      html('qIdeal', '<div class="qt">QUADRO SUGERIDO PELA R\u00c9GUA</div><div class="qtab">' + tab + '</div><div class="qv">' + esc(frase) + '. ' + fim + '</div>');
    }
    html('qForm', 'Vendedores \u2264 faturamento \u00f7 ' + esc(rs(r.pV)) + ' \u00b7 Apoio \u2265 sa\u00edda f\u00edsica \u00f7 ' + esc(rs(r.pA)) +
      ' \u00b7 Quadro \u2264 faturamento \u00f7 ' + esc(rs(r.pC)) + '. O ideal s\u00f3 corta o que passa da r\u00e9gua e s\u00f3 refor\u00e7a o apoio que est\u00e1 abaixo do piso f\u00edsico.');
  }

  /* ================= FOCO ================= */
  var PRE = { '25/5': [25, 5], '50/10': [50, 10], '15/3': [15, 3] };
  var C_FOCO = 1105.84;
  function focoNovo() { return { pre: '25/5', modo: 'foco', rod: false, fim: 0, resta: 25 * 60000 }; }
  if (!est.foco || typeof est.foco !== 'object' || !PRE[est.foco.pre]) { est.foco = focoNovo(); }
  function dur(modo) { var p = PRE[est.foco.pre]; return (modo === 'foco' ? p[0] : p[1]) * 60000; }
  function registrar(fimMs, min) {
    var d = corr(new Date(fimMs)), k = chave(d);
    if (!est.log[k]) { est.log[k] = []; }
    est.log[k].push({ h: hhmm(d), min: min });
    var ks = [];
    for (var x in est.log) { if (est.log.hasOwnProperty(x)) { ks.push(x); } }
    ks.sort();
    while (ks.length > 30) { delete est.log[ks.shift()]; }
  }
  function trocarFase(natural) {
    var f = est.foco;
    if (f.modo === 'foco') {
      if (natural) { registrar(f.fim, dur('foco') / 60000); }
      f.modo = 'pausa'; f.resta = dur('pausa');
      if (natural) { f.fim = f.fim + f.resta; f.rod = true; } else { f.rod = false; }
      if (natural) { alertar('Foco conclu\u00eddo! Hora da pausa de ' + (dur('pausa') / 60000) + ' minutos.', 'A pausa j\u00e1 come\u00e7ou a contar.'); }
    } else {
      f.modo = 'foco'; f.resta = dur('foco'); f.rod = false;
      if (natural) { alertar('Pausa encerrada.', 'Toque em Iniciar para o pr\u00f3ximo foco.'); }
    }
    salvar();
    renderFoco();
    if (est.aba === 'agora') { renderAgora(); }
  }
  function focoAcao(a) {
    var f = est.foco, ms = agoraMs();
    somLiberar();
    if (a === 'play') {
      if (f.rod) { f.resta = Math.max(0, f.fim - ms); f.rod = false; }
      else { if (f.resta <= 0) { f.resta = dur(f.modo); } f.fim = ms + f.resta; f.rod = true; }
    } else if (a === 'reset') { f.rod = false; f.resta = dur(f.modo); }
    else if (a === 'pular') { trocarFase(false); return; }
    salvar();
    renderFoco();
  }
  function focoPreset(p) {
    if (!PRE[p]) { return; }
    var f = est.foco;
    f.pre = p; f.modo = 'foco'; f.rod = false; f.resta = dur('foco');
    salvar();
    renderFoco();
  }
  function restaFoco(ms) { var f = est.foco; return f.rod ? Math.max(0, f.fim - ms) : f.resta; }
  function mmss(msx) { var s = Math.ceil(msx / 1000), m = Math.floor(s / 60); return pad2(m) + ':' + pad2(s % 60); }
  function focoTick(ms) {
    var f = est.foco, voltas = 0;
    while (f.rod && ms >= f.fim && voltas < 3) { trocarFase(true); voltas++; }
    desenharTempoFoco(ms);
  }
  function desenharTempoFoco(ms) {
    var f = est.foco, resta = restaFoco(ms), total = dur(f.modo);
    if (est.aba === 'foco') {
      txt('fTempo', mmss(resta));
      var arco = $('fArco');
      arco.style.strokeDashoffset = String(C_FOCO * (1 - resta / total));
      arco.style.stroke = f.modo === 'foco' ? '#22d3ee' : '#4ee892';
    }
    var s = f.rod ? 'Foco <span class="rodando">' + mmss(resta) + '</span>' : 'Foco';
    if (s !== ultimaAbaFoco) { ultimaAbaFoco = s; html('tabFocoTxt', s); }
  }
  var ultimaAbaFoco = '';
  function renderFoco() {
    var f = est.foco, ms = agoraMs();
    txt('fModo', f.modo === 'foco' ? 'FOCO' : 'PAUSA');
    $('fModo').style.color = f.modo === 'foco' ? '#22d3ee' : '#4ee892';
    txt('fFim', f.rod ? 'termina \u00e0s ' + hhmm(corr(new Date(f.fim))) : (f.resta < dur(f.modo) ? 'pausado' : (f.modo === 'foco' ? 'pronto para come\u00e7ar' : 'pausa pronta')));
    txt('fPlay', f.rod ? 'Pausar' : (f.resta < dur(f.modo) ? 'Continuar' : 'Iniciar'));
    classe($('pre-25'), 'on', f.pre === '25/5');
    classe($('pre-50'), 'on', f.pre === '50/10');
    classe($('pre-15'), 'on', f.pre === '15/3');
    desenharTempoFoco(ms);

    var hoje = agora(), lg = est.log[chave(hoje)] || [], tot = 0, i;
    for (i = 0; i < lg.length; i++) { tot += lg[i].min; }
    var s = '<div class="fsec"><div class="tl">HOJE</div><div class="fbig mono">' + lg.length + '</div>' +
      '<div class="fsub">' + plural(lg.length, 'sess\u00e3o de foco', 'sess\u00f5es de foco') + (tot ? ' \u00b7 ' + minTxt(tot) : '') + '</div></div>' +
      '<div class="fsec" style="padding-top:0">';
    if (!lg.length) { s += '<div class="fsub" style="font-size:13px;line-height:19px">Cada foco completo entra nesta lista. Pular n\u00e3o conta.</div>'; }
    for (i = lg.length - 1; i >= 0 && i >= lg.length - 8; i--) {
      s += '<div class="fl2"><span>' + esc(lg[i].h) + '</span>' + lg[i].min + ' min de foco</div>';
    }
    if (lg.length > 8) { s += '<div class="fsub" style="font-size:12px;margin-top:6px">+ ' + (lg.length - 8) + ' antes</div>'; }
    s += '</div>';
    // semana em barrinhas (seg a dom)
    var seg = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - ((hoje.getDay() + 6) % 7)), cont = [], maior = 1;
    for (i = 0; i < 7; i++) {
      var dd = new Date(seg.getFullYear(), seg.getMonth(), seg.getDate() + i), l2 = est.log[chave(dd)];
      cont.push({ n: l2 ? l2.length : 0, d: dd });
      if (cont[i].n > maior) { maior = cont[i].n; }
    }
    s += '<div class="fsem"><div class="tl">ESTA SEMANA</div>';
    for (i = 0; i < 7; i++) {
      var hb = Math.round(cont[i].n / maior * 96), ehHoje = chave(cont[i].d) === chave(hoje);
      s += '<div class="fsb" style="left:' + (i * 32) + 'px">' +
        '<span class="fsn">' + (cont[i].n || '') + '</span>' +
        '<i style="height:' + Math.max(hb, 3) + 'px;' + (cont[i].n ? '' : 'background:#10243c;') + (ehHoje ? 'box-shadow:0 0 10px rgba(34,211,238,0.6);' : '') + '"></i>' +
        '<span class="fsd' + (ehHoje ? ' ciano' : '') + '">' + DC[cont[i].d.getDay()].charAt(0).toUpperCase() + '</span></div>';
    }
    s += '</div>';
    html('fEsq', s);
    renderFocoDir();
  }
  function renderFocoDir() {
    var hoje = agora(), im = infoMes(hoje.getFullYear(), hoje.getMonth(), hoje, true);
    var sem = 0, d0 = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - ((hoje.getDay() + 6) % 7));
    for (var i = 0; i < 7; i++) {
      var lg = est.log[chave(new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + i))];
      if (lg) { sem += lg.length; }
    }
    html('fDir', '<div class="fsec"><div class="tl">AGORA</div><div class="fhora mono" id="fHora">' + hhmm(hoje) + '</div>' +
      '<div class="fsub">' + esc(DIAS[hoje.getDay()]) + ', ' + ddmm(hoje) + '</div></div>' +
      '<div class="fsec" style="padding-top:4px"><div class="tl">NO M\u00caS</div><div class="fsub" style="margin-top:6px;font-size:15px;color:#e8f2ff">dia \u00fatil ' + fDias(im.ate) + ' de ' + fDias(im.tot) + '</div></div>' +
      '<div class="fsec" style="padding-top:4px"><div class="tl">NESTA SEMANA</div><div class="fsub" style="margin-top:6px;font-size:15px;color:#e8f2ff">' + sem + ' ' + plural(sem, 'sess\u00e3o', 'sess\u00f5es') + ' de foco</div></div>');
  }

  /* ================= som e aviso ================= */
  var audio = null;
  function somLiberar() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { return; }
      if (!audio) { audio = new AC(); }
      var o = audio.createOscillator(), g = audio.createGain();
      g.gain.value = 0.0001;
      o.connect(g); g.connect(audio.destination);
      if (o.start) { o.start(0); o.stop(audio.currentTime + 0.05); } else { o.noteOn(0); o.noteOff(audio.currentTime + 0.05); }
      if (audio.resume) { audio.resume(); }
    } catch (e) { audio = null; }
  }
  function bipe() {
    if (!audio) { return; }
    try {
      var t0 = audio.currentTime + 0.05;
      for (var i = 0; i < 3; i++) {
        var o = audio.createOscillator(), g = audio.createGain(), t = t0 + i * 0.4;
        o.frequency.value = i === 2 ? 1320 : 880;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
        o.connect(g); g.connect(audio.destination);
        if (o.start) { o.start(t); o.stop(t + 0.34); } else { o.noteOn(t); o.noteOff(t + 0.34); }
      }
    } catch (e) { /* sem som */ }
  }
  var avisoTimer = null;
  function alertar(msg, sub) {
    var av = $('aviso'), fl = $('flash');
    av.innerHTML = esc(msg) + (sub ? '<small>' + esc(sub) + '</small>' : '');
    classe(av, 'on', false); void av.offsetWidth; classe(av, 'on', true);
    classe(fl, 'on', false); void fl.offsetWidth; classe(fl, 'on', true);
    bipe();
    if (avisoTimer) { clearTimeout(avisoTimer); }
    avisoTimer = setTimeout(function () { classe(av, 'on', false); }, 9000);
  }

  /* ================= navega\u00e7\u00e3o ================= */
  function irAba(a) {
    var ok = false;
    for (var i = 0; i < ABAS.length; i++) { if (ABAS[i] === a) { ok = true; } }
    if (!ok) { a = ABAS[0]; }
    est.aba = a;
    salvar();
    for (var j = 0; j < ABAS.length; j++) {
      classe($('pg-' + ABAS[j]), 'on', ABAS[j] === a);
      classe($('tab-' + ABAS[j]), 'on', ABAS[j] === a);
    }
    if (a === 'agora') { renderAgora(); renderCal(); }
    else if (a === 'ritmo') { renderRitmo(); }
    else if (a === 'quadro') { renderQuadro(); }
    else if (a === 'foco') { renderFoco(); }
    else if (EXTRAS[a] && EXTRAS[a].render) { EXTRAS[a].render(); }
  }
  var ACOES = {
    aba: function (arg) { irAba(arg); },
    dia: function (arg) { alternarDia(arg); renderCal(); renderAgora(); },
    mes: function (arg) {
      var h = agora(), n = parseInt(arg, 10);
      if (!vista || n === 0) { vista = { y: h.getFullYear(), m: h.getMonth() }; }
      if (n !== 0) { var d = new Date(vista.y, vista.m + n, 1); vista = { y: d.getFullYear(), m: d.getMonth() }; }
      renderCal();
    },
    sab: function (arg) { est.sab = parseFloat(arg); salvar(); renderCal(); renderAgora(); },
    campo: function (arg) {
      var pg = est.aba;
      if (CAMPOS[pg] && CAMPOS[pg][arg]) { ativo[pg] = arg; if (pg === 'ritmo') { renderRitmo(); } else { renderQuadro(); } }
    },
    tecla: function (arg) { tecla(arg); },
    ate: function (arg) { var r = dadosRitmo(); r.ate = arg === 'hoje' ? 'hoje' : 'ontem'; salvar(); renderRitmo(); },
    foco: function (arg) { focoAcao(arg); },
    preset: function (arg) { focoPreset(arg); },
    aviso: function () { classe($('aviso'), 'on', false); if (est.aba !== 'foco') { irAba('foco'); } },
    dst: function (arg) {
      est.dst = arg === 'corrigir' ? 'corrigir' : (arg === 'ok' ? 'ok' : '');
      salvar();
      ultimoDia = '';
      tick();
    }
  };
  function agir(el) {
    var f = ACOES[el.getAttribute('data-act')];
    if (f) { f(el.getAttribute('data-arg'), el); }
  }

  /* ================= toques =================
     O iBooks usa toques para virar p\u00e1gina, zoom e menus. Aqui o app segura
     todos os toques (preventDefault), menos nas faixas marcadas data-livre:
     o rodap\u00e9 e o logo, que devolvem o toque para o iBooks. */
  function acharAlvo(el) {
    while (el && el.nodeType === 1) {
      if (el.getAttribute('data-act')) { return el; }
      el = el.parentNode;
    }
    return null;
  }
  function livre(el) {
    while (el && el.nodeType === 1) {
      if (el.getAttribute('data-livre')) { return true; }
      el = el.parentNode;
    }
    return false;
  }
  function campoDeTexto(el) {
    var t = el && el.tagName ? String(el.tagName).toUpperCase() : '';
    return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT';
  }
  function alvoDoToque(e) {
    var el = e.target;
    if (el && el.nodeType === 3) { el = el.parentNode; }
    return el;
  }
  var toque = null, ultimoToque = 0, OPT = false;
  try {
    var teste = Object.defineProperty({}, 'passive', { get: function () { OPT = { passive: false }; return false; } });
    window.addEventListener('cockpit-teste', null, teste);
    window.removeEventListener('cockpit-teste', null, teste);
  } catch (e) { OPT = false; }
  function ligarToques() {
    document.addEventListener('touchstart', function (e) {
      ultimoToque = agoraMs();
      var el = alvoDoToque(e);
      if (livre(el) || campoDeTexto(el)) { toque = null; return; }
      e.preventDefault();
      var t = e.changedTouches[0], alvo = acharAlvo(el);
      if (toque && toque.el) { classe(toque.el, 'down', false); }
      toque = alvo ? { el: alvo, x: t.clientX, y: t.clientY } : null;
      if (alvo) { classe(alvo, 'down', true); }
    }, OPT);
    document.addEventListener('touchmove', function (e) {
      var em = alvoDoToque(e);
      if (livre(em) || campoDeTexto(em)) { return; }
      e.preventDefault();
      if (!toque) { return; }
      var t = e.changedTouches[0];
      if (Math.abs(t.clientX - toque.x) > 16 || Math.abs(t.clientY - toque.y) > 16) {
        classe(toque.el, 'down', false);
        toque = null;
      }
    }, OPT);
    document.addEventListener('touchend', function (e) {
      ultimoToque = agoraMs();
      var ef = alvoDoToque(e);
      if (livre(ef) || campoDeTexto(ef)) { return; }
      e.preventDefault();
      if (!toque) { return; }
      var el = toque.el;
      toque = null;
      classe(el, 'down', false);
      agir(el);
    }, OPT);
    document.addEventListener('touchcancel', function () {
      if (toque) { classe(toque.el, 'down', false); toque = null; }
    }, OPT);
    // mouse: s\u00f3 para testar num computador
    document.addEventListener('mousedown', function (e) {
      if (agoraMs() - ultimoToque < 1000) { return; }
      var alvo = acharAlvo(e.target);
      if (!alvo) { return; }
      e.preventDefault();
      classe(alvo, 'down', true);
      setTimeout(function () { classe(alvo, 'down', false); }, 140);
      agir(alvo);
    }, false);
  }

  /* ================= rel\u00f3gio ================= */
  var ultimoDia = '';
  function renderTudo() {
    renderAgora(); renderCal(); renderRitmo(); renderQuadro(); renderFoco();
  }
  function tick() {
    var now = agora(), k = chave(now);
    txt('relH', pad2(now.getHours()) + ':' + pad2(now.getMinutes()));
    txt('relS', ':' + pad2(now.getSeconds()));
    txt('topoHora', pad2(now.getHours()) + ':' + pad2(now.getMinutes()));
    var fh = $('fHora');
    if (fh) { txt('fHora', hhmm(now)); }
    if (k !== ultimoDia) {
      ultimoDia = k;
      txt('topoData', DC[now.getDay()] + ' \u00b7 ' + ddmm(now) + ' \u00b7 ' + now.getFullYear());
      vista = null;
      renderTudo();
    }
    focoTick(agoraMs());
    for (var x in EXTRAS) { if (EXTRAS.hasOwnProperty(x) && EXTRAS[x].tick) { EXTRAS[x].tick(now); } }
  }

  /* ================= in\u00edcio ================= */
  /* No Safari a tela tem outro tamanho (barra de status, outros aparelhos): escala o app inteiro.
     No iBooks o viewport j\u00e1 \u00e9 1024x768 e nada muda. */
  function ajustarEscala() {
    if (navigator.epubReadingSystem) { return; }
    var app = $('app'), w = window.innerWidth || 1024, h = window.innerHeight || 768;
    var s = Math.min(w / 1024, h / 768, 1.5);
    var x = Math.max(0, Math.round((w - 1024 * s) / 2));
    var t = (s > 0.999 && s < 1.001 && x === 0) ? '' : 'translate(' + x + 'px,0px) scale(' + s + ')';
    app.style.webkitTransformOrigin = '0 0';
    app.style.transformOrigin = '0 0';
    app.style.webkitTransform = t;
    app.style.transform = t;
  }
  function iniciar() {
    // uma aba existe quando a p\u00e1gina e o bot\u00e3o dela est\u00e3o no documento (a vers\u00e3o web pode esconder abas tirando o bot\u00e3o)
    for (var i = 0; i < TODAS_ABAS.length; i++) { if ($('pg-' + TODAS_ABAS[i]) && $('tab-' + TODAS_ABAS[i])) { ABAS.push(TODAS_ABAS[i]); } }
    window.cockpitUtil = {
      $: $, esc: esc, html: html, txt: txt, classe: classe, num: num, curto: curto, rs: rs, pct: pct,
      pad2: pad2, hhmm: hhmm, ddmm: ddmm, DC: DC, DIAS: DIAS, MESES: MESES, plural: plural, minTxt: minTxt,
      agora: agora, corr: corr, acoes: ACOES, irAba: irAba, versao: VERSAO, abaAtual: function () { return est.aba; }
    };
    for (var x in EXTRAS) { if (EXTRAS.hasOwnProperty(x) && EXTRAS[x].iniciar) { EXTRAS[x].iniciar(window.cockpitUtil); } }
    montarTeclado('kp-ritmo');
    montarTeclado('kp-quadro');
    ligarToques();
    ajustarEscala();
    window.addEventListener('resize', ajustarEscala, false);
    window.addEventListener('orientationchange', function () { setTimeout(ajustarEscala, 300); }, false);
    irAba(est.aba);
    tick();
    setInterval(tick, 1000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { ultimoDia = ''; tick(); } }, false);
    window.addEventListener('pageshow', function () { ultimoDia = ''; tick(); }, false);
    window.cockpit = { versao: VERSAO, estado: est, calcRitmo: calcRitmo, calcQuadro: calcQuadro, infoMes: infoMes, feriadosAno: feriadosAno, curto: curto };
  }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', iniciar, false); }
  else { iniciar(); }
})();
