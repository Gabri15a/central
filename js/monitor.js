/* Central \u00b7 Monitor (aba do Cockpit, vers\u00e3o web para o Safari do iPad 2).
   Busca pela internet do pr\u00f3prio iPad o status que o coletor do PC publica no GitHub,
   abre com a chave da Central (AES-256-CTR, chave = SHA-256 de "central:" + chave digitada)
   e mostra o sem\u00e1foro s\u00f3 com os grupos que o PC publica (config.json > grupos no PC).
   Alarme sonoro opcional: toca quando aparece um problema novo (vermelho) ou os dados param de chegar.
   Somente ES5. */
(function () {
  'use strict';

  var U = null;
  var LS_CHAVE = 'central.chave';
  var LS_ULTIMO = 'central.ultimo';
  var LS_ALARME = 'central.alarme';
  var LS_VISTOS = 'central.alarme.vistos';
  var INTERVALO = 60000;
  var GRUPOS = [
    { id: 'bi', nome: 'BI' },
    { id: 'ferramentas', nome: 'FERRAMENTAS' },
    { id: 'rotinas', nome: 'ROTINAS DO CLAUDE' },
    { id: 'pendencias', nome: 'PEND\u00caNCIAS' }
  ];
  var COR = { ok: '#4ee892', alerta: '#f59e0b', erro: '#ff7a7a', info: '#7fc4ff', off: '#4b6284' };
  var PESO = { erro: 4, alerta: 3, info: 2, ok: 1, off: 0 };
  var REDE = {
    iniciando: ['cinza', 'CONECTANDO'], online: ['verde', 'ONLINE'], offline: ['vermelho', 'SEM INTERNET'],
    chave: ['vermelho', 'CHAVE ERRADA'], semchave: ['ambar', 'SEM CHAVE'], semdados: ['ambar', 'SEM DADOS'],
    erro: ['vermelho', 'ERRO']
  };
  var m = { chave: '', env: null, dados: null, recebidoEm: 0, rede: 'iniciando', msg: '', buscando: false, proxima: 0, ultimoRender: 0, det: null, pag: 0, tentativas: 0 };
  var POR_PAGINA = 10;
  /* alarme: toca sem parar nos 3 primeiros minutos e depois lembra a cada 5 minutos, at\u00e9 tocar em Ciente */
  var ALARME_FORTE = 180000, REPETE_FORTE = 2600, REPETE_FRACO = 300000;
  var al = { ligado: false, base: false, vistos: {}, tocando: false, desde: 0, ultimoSom: 0, lista: [] };
  var som = { el: null, ac: null, liberado: false, elOk: false };

  function ler(k) { try { return window.localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function gravar(k, v) {
    try { if (v === null) { window.localStorage.removeItem(k); } else { window.localStorage.setItem(k, v); } } catch (e) { /* sem armazenamento */ }
  }
  function normalizar(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function formatar(c) {
    c = normalizar(c);
    var p = [];
    for (var i = 0; i < c.length; i += 4) { p.push(c.substr(i, 4)); }
    return p.join('-');
  }
  function agoraMs() { return new Date().getTime(); }
  function quando(iso) { var t = iso ? Date.parse(iso) : NaN; return isNaN(t) ? null : t; }
  /* hora de Bras\u00edlia, mesmo com o fuso desatualizado do iOS 9 */
  function hora(ms) { var d = new Date(ms); return U.hhmm(U.corr ? U.corr(d) : d); }
  function idadeTxt(ms) {
    var min = Math.floor(Math.max(0, ms) / 60000);
    if (min < 1) { return 'agora'; }
    if (min < 60) { return 'h\u00e1 ' + min + ' min'; }
    var h = Math.floor(min / 60);
    if (h < 24) { return 'h\u00e1 ' + h + 'h' + (min % 60 ? U.pad2(min % 60) : ''); }
    var d = Math.floor(h / 24);
    return 'h\u00e1 ' + d + ' ' + U.plural(d, 'dia', 'dias');
  }

  /* ---------- de onde vem o status ---------- */
  function fonte() {
    if (window.CENTRAL_FONTE) { return window.CENTRAL_FONTE; }
    var h = /^([a-z0-9-]+)\.github\.io$/i.exec(location.hostname), repo = location.pathname.split('/')[1] || '';
    if (h && repo) { return 'https://raw.githubusercontent.com/' + h[1] + '/' + repo + '/dados/status.json'; }
    return 'dados/status.json';
  }

  /* ---------- abrir o envelope criptografado ---------- */
  function bytes(b64) {
    var s = window.atob(b64), a = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) { a[i] = s.charCodeAt(i); }
    return a;
  }
  function abrir(env, chave) {
    if (!env || env.alg !== 'aes-256-ctr' || !env.iv || !env.dados) { throw new Error('formato'); }
    var k = window.sha256.array('central:' + normalizar(chave));
    var ctr = new window.aesjs.ModeOfOperation.ctr(k, new window.aesjs.Counter(bytes(env.iv)));
    var texto = window.aesjs.utils.utf8.fromBytes(ctr.decrypt(bytes(env.dados))), o = null;
    try { o = JSON.parse(texto); } catch (e) { o = null; }
    if (!o || o.central !== 1) { throw new Error('chave'); }
    return o;
  }

  /* ---------- busca ---------- */
  function tratar(status, texto) {
    if (status === 200) {
      var env = null;
      try { env = JSON.parse(texto); } catch (e) { env = null; }
      if (!env) { m.rede = 'erro'; m.msg = 'O arquivo de status veio inv\u00e1lido.'; return; }
      m.env = env;
      if (!m.chave) { m.rede = 'semchave'; m.msg = ''; return; }
      try {
        m.dados = abrir(env, m.chave);
        m.recebidoEm = agoraMs();
        m.rede = 'online';
        m.msg = '';
        gravar(LS_ULTIMO, JSON.stringify({ dados: m.dados, recebidoEm: m.recebidoEm }));
      } catch (e2) { m.rede = 'chave'; m.msg = 'A chave salva n\u00e3o abre os dados do PC.'; }
    } else if (status === 404) {
      m.rede = 'semdados'; m.msg = 'O PC ainda n\u00e3o publicou o status.';
    } else {
      m.rede = 'offline';
      m.msg = status ? 'Erro ' + status + ' ao buscar o status.' : 'Sem internet, ou o certificado do site n\u00e3o foi aceito.';
    }
  }
  function buscar(manual) {
    if (m.buscando) { return; }
    m.buscando = true;
    if (manual) { m.msg = 'Buscando\u2026'; render(); }
    var x = new XMLHttpRequest(), url = fonte(), terminou = false;
    function fim(status, texto) {
      if (terminou) { return; }
      terminou = true;
      m.buscando = false;
      m.tentativas++;
      m.proxima = agoraMs() + INTERVALO;
      tratar(status, texto);
      render();
    }
    try {
      x.open('GET', url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + agoraMs(), true);
      x.timeout = 20000;
      x.onreadystatechange = function () { if (x.readyState === 4) { fim(x.status, x.responseText); } };
      x.ontimeout = function () { fim(0, ''); };
      x.onerror = function () { fim(0, ''); };
      x.send(null);
    } catch (e) { fim(0, ''); }
  }

  /* ---------- grupos publicados pelo PC ---------- */
  function itensDo(grupo) {
    var d = m.dados, itens = [];
    if (d && d.grupos) {
      for (var i = 0; i < d.grupos.length; i++) { if (d.grupos[i] && d.grupos[i].id === grupo) { itens = d.grupos[i].itens || []; } }
    }
    return itens;
  }
  /* s\u00f3 os grupos que o PC publica, na ordem do Monitor; sem dados, BI e Ferramentas */
  function gruposVisiveis() {
    var d = m.dados, vis = [], i, j;
    if (d && d.grupos && d.grupos.length) {
      for (i = 0; i < GRUPOS.length; i++) {
        for (j = 0; j < d.grupos.length; j++) { if (d.grupos[j] && d.grupos[j].id === GRUPOS[i].id) { vis.push(GRUPOS[i]); break; } }
      }
    }
    return vis.length ? vis : GRUPOS.slice(0, 2);
  }
  /* 1 grupo: tela toda \u00b7 2: cart\u00f5es altos lado a lado \u00b7 3 e 4: grade 2x2 (o 3\u00ba ocupa a linha de baixo) */
  function posicoes(vis) {
    var n = vis.length, pos = {}, i;
    for (i = 0; i < n; i++) {
      var alto = n <= 2, largo = n === 1 || (n === 3 && i === 2);
      pos[vis[i].id] = { x: largo || i % 2 === 0 ? 16 : 520, y: alto || i < 2 ? 114 : 396, w: largo ? 992 : 488, h: alto ? 552 : 270 };
    }
    return pos;
  }
  function contar() {
    var c = { erro: 0, alerta: 0, total: 0 }, vis = gruposVisiveis();
    for (var g = 0; g < vis.length; g++) {
      var it = itensDo(vis[g].id);
      for (var i = 0; i < it.length; i++) {
        c.total++;
        if (it[i].estado === 'erro') { c.erro++; } else if (it[i].estado === 'alerta') { c.alerta++; }
      }
    }
    return c;
  }
  function dadosVelhos() {
    var d = m.dados, gerado = d ? quando(d.gerado) : null;
    if (gerado === null) { return false; }
    return agoraMs() - gerado > ((d.pc && d.pc.intervaloMin) || 5) * 3 * 60000;
  }

  /* ---------- desenho ---------- */
  function renderHero() {
    var d = m.dados, agora = agoraMs(), gerado = d ? quando(d.gerado) : null, c = contar();
    var velho = dadosVelhos();
    var cor, sim, tit, sub;
    if (!d) { cor = 'off'; sim = '?'; tit = m.chave ? 'Esperando os dados do PC' : 'Monitor sem chave'; }
    else if (velho) { cor = 'erro'; sim = '!'; tit = (m.rede === 'offline' ? 'iPad sem internet ' : 'O PC parou de enviar ') + idadeTxt(agora - gerado); }
    else if (c.erro) {
      cor = 'erro'; sim = '!';
      tit = c.erro + ' ' + U.plural(c.erro, 'problema', 'problemas') + (c.alerta ? ' \u00b7 ' + c.alerta + ' ' + U.plural(c.alerta, 'alerta', 'alertas') : '');
    } else if (c.alerta) { cor = 'alerta'; sim = '!'; tit = c.alerta + ' ' + U.plural(c.alerta, 'ponto de aten\u00e7\u00e3o', 'pontos de aten\u00e7\u00e3o'); }
    else { cor = 'ok'; sim = '\u2713'; tit = 'Tudo certo'; }
    var sem = U.$('mSem');
    sem.style.background = COR[cor];
    sem.style.boxShadow = cor === 'off' ? 'none' : '0 0 22px ' + COR[cor];
    U.txt('mSem', sim);
    U.txt('mTit', tit);
    if (d && gerado !== null) {
      sub = 'Dados do PC' + (d.pc && d.pc.nome ? ' ' + d.pc.nome : '') + ' de ' + hora(gerado) + ' (' + idadeTxt(agora - gerado) + ')';
      if (gerado - agora > 300000) { sub = 'O rel\u00f3gio do iPad est\u00e1 atrasado: ligue Ajustes \u203a Geral \u203a Data e Hora \u203a Autom\u00e1tico'; }
      else if (m.rede !== 'online' && m.msg) { sub += ' \u00b7 ' + m.msg; }
    } else {
      sub = m.msg || (m.chave ? 'Buscando o status publicado pelo PC\u2026' : 'Toque em Chave e digite a chave da Central.');
    }
    U.txt('mSub', sub);
    var r = REDE[m.rede] || REDE.erro;
    U.html('mRede', '<span class="pill ' + r[0] + '">' + r[1] + '</span>');
    U.classe(U.$('pg-monitor'), 'velho', velho);
    var dot = U.$('tabMonDot');
    if (dot) { dot.style.background = COR[cor]; }
  }
  function renderGrupo(g, max) {
    var agora = agoraMs(), itens = itensDo(g.id).slice(0), i;
    for (i = 0; i < itens.length; i++) { itens[i]._o = i; }
    itens.sort(function (a, b) { return ((PESO[b.estado] || 0) - (PESO[a.estado] || 0)) || (a._o - b._o); });
    var nErro = 0, nAlerta = 0, nAtivos = 0;
    for (i = 0; i < itens.length; i++) {
      if (itens[i].estado === 'erro') { nErro++; } else if (itens[i].estado === 'alerta') { nAlerta++; }
      if (itens[i].estado !== 'off') { nAtivos++; }
    }
    var pill = nErro ? ['vermelho', nErro + ' ' + U.plural(nErro, 'PROBLEMA', 'PROBLEMAS')] :
      (nAlerta ? ['ambar', nAlerta + ' ' + U.plural(nAlerta, 'ALERTA', 'ALERTAS')] :
      (nAtivos ? ['verde', 'OK'] : ['cinza', itens.length ? 'EM BREVE' : '\u2014']));
    var s = '<div class="mgt">' + U.esc(g.nome) + '</div><div class="mgr"><span class="pill pq ' + pill[0] + '">' + pill[1] + '</span></div><div class="mlista">';
    if (!itens.length) { s += '<div class="mvazio">' + (m.dados ? 'Nada para mostrar aqui.' : 'Sem dados ainda.') + '</div>'; }
    for (i = 0; i < itens.length && i < max; i++) {
      var it = itens[i], est = COR[it.estado] ? it.estado : 'info', t = quando(it.quando);
      s += '<div class="mi ' + est + (i === 0 ? ' prim' : '') + '"><i class="md ' + est + '" style="background:' + COR[est] + '"></i>' +
        '<div class="mn">' + U.esc(it.nome || '') + '</div><div class="mv">' + U.esc(it.valor || '') + '</div>' +
        '<div class="mdt">' + U.esc(it.detalhe || '') + '</div><div class="ma">' + (t !== null ? idadeTxt(agora - t) : '') + '</div></div>';
    }
    s += '</div>';
    if (itens.length > max) {
      var resto = itens.length - max;
      s += '<div class="mmais">+ ' + resto + ' ' + U.plural(resto, 'outro item', 'outros itens') + ' \u00b7 toque para ver todos</div>';
    }
    U.html('mG-' + g.id, s);
  }
  function renderGrupos() {
    var vis = gruposVisiveis(), pos = posicoes(vis);
    for (var i = 0; i < GRUPOS.length; i++) {
      var g = GRUPOS[i], el = U.$('mG-' + g.id), p = pos[g.id];
      if (!el) { continue; }
      if (!p) { el.style.display = 'none'; continue; }
      el.style.display = 'block';
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
      el.style.width = p.w + 'px';
      el.style.height = p.h + 'px';
      renderGrupo(g, Math.max(1, Math.floor((p.h - 66) / 50)));
    }
  }

  /* ---------- lista completa de um grupo (toque no cart\u00e3o) ---------- */
  function itensOrdenados(id) {
    var itens = itensDo(id).slice(0), i, extra = [];
    for (i = 0; i < itens.length; i++) {
      itens[i]._o = i;
      // o resumo "modelos parados" traz a lista dos parados: entra como linhas pr\u00f3prias no detalhe
      if (itens[i].parados && itens[i].parados.length) {
        for (var j = 0; j < itens[i].parados.length; j++) {
          var p = itens[i].parados[j];
          extra.push({ nome: p.nome, estado: 'off', valor: 'parado', detalhe: (p.area || '') + ' \u00b7 ' + (p.motivo || ''), quando: p.desde, _o: 1000 + j });
        }
      }
    }
    itens = itens.concat(extra);
    itens.sort(function (a, b) { return ((PESO[b.estado] || 0) - (PESO[a.estado] || 0)) || (a._o - b._o); });
    return itens;
  }
  function renderDetalhe() {
    if (!m.det) { return; }
    var g = null, i;
    for (i = 0; i < GRUPOS.length; i++) { if (GRUPOS[i].id === m.det) { g = GRUPOS[i]; } }
    var itens = itensOrdenados(m.det), total = itens.length, paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
    if (m.pag > paginas - 1) { m.pag = paginas - 1; }
    if (m.pag < 0) { m.pag = 0; }
    U.txt('mDetTit', (g ? g.nome : '') + ' \u00b7 ' + total + ' ' + U.plural(total, 'item', 'itens'));
    var agora = agoraMs(), s = '';
    for (i = m.pag * POR_PAGINA; i < total && i < (m.pag + 1) * POR_PAGINA; i++) {
      var it = itens[i], est = COR[it.estado] ? it.estado : 'info', t = quando(it.quando);
      s += '<div class="mi ' + est + (i === m.pag * POR_PAGINA ? ' prim' : '') + '"><i class="md ' + est + '" style="background:' + COR[est] + '"></i>' +
        '<div class="mn">' + U.esc(it.nome || '') + '</div><div class="mv">' + U.esc(it.valor || '') + '</div>' +
        '<div class="mdt">' + U.esc(it.detalhe || '') + '</div><div class="ma">' + (t !== null ? idadeTxt(agora - t) : '') + '</div></div>';
    }
    if (!total) { s = '<div class="mvazio">Nada para mostrar aqui.</div>'; }
    U.html('mDetLista', s);
    U.txt('mDetPag', 'p\u00e1gina ' + (m.pag + 1) + ' de ' + paginas);
    U.classe(U.$('mDetAnt'), 'off', m.pag === 0);
    U.classe(U.$('mDetProx'), 'off', m.pag >= paginas - 1);
  }
  function abrirDetalhe(id) {
    m.det = id; m.pag = 0;
    U.classe(U.$('mDet'), 'esc', false);
    renderDetalhe();
  }
  function fecharDetalhe() { m.det = null; U.classe(U.$('mDet'), 'esc', true); }
  function render() {
    if (!U) { return; }
    m.ultimoRender = agoraMs();
    renderHero();
    renderGrupos();
    renderDetalhe();
    verificarAlarme();
    renderAlarmeBotao();
  }

  /* ---------- som do alarme ----------
     O iOS s\u00f3 deixa tocar som depois de um toque na tela. O <audio> toca mesmo com o iPad no silencioso;
     o Web Audio fica de reserva, se o arquivo n\u00e3o tocar. */
  function prepararSom(vaiTocar) {
    if (!som.el) {
      som.el = U.$('mSom');
      if (som.el) {
        som.el.addEventListener('playing', function () { som.elOk = true; }, false);
        som.el.addEventListener('error', function () { som.elOk = false; }, false);
      }
    }
    if (!som.liberado && som.el && !vaiTocar) {
      try { som.el.load(); } catch (e) { /* nada */ }
    }
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC && !som.ac) { som.ac = new AC(); }
      if (som.ac) {
        var b = som.ac.createBuffer(1, 1, 22050), s = som.ac.createBufferSource();
        s.buffer = b;
        s.connect(som.ac.destination);
        if (s.start) { s.start(0); } else { s.noteOn(0); }
        if (som.ac.resume) { som.ac.resume(); }
      }
    } catch (e2) { som.ac = null; }
    som.liberado = true;
  }
  function bipe() {
    var ac = som.ac;
    if (!ac) { return; }
    try {
      var t0 = ac.currentTime + 0.05;
      for (var i = 0; i < 6; i++) {
        var o = ac.createOscillator(), g = ac.createGain(), t = t0 + i * 0.2;
        try { o.type = 'square'; } catch (e1) { /* tom padr\u00e3o */ }
        o.frequency.value = i % 2 ? 740 : 988;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
        g.gain.setValueAtTime(0.3, t + 0.14);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        o.connect(g);
        g.connect(ac.destination);
        if (o.start) { o.start(t); o.stop(t + 0.17); } else { o.noteOn(t); o.noteOff(t + 0.17); }
      }
    } catch (e) { /* sem som */ }
  }
  function tocar() {
    var foi = false;
    if (som.el && !som.el.error) {
      try { som.el.currentTime = 0; } catch (e) { /* ainda carregando */ }
      try {
        var r = som.el.play();
        // navegadores novos devolvem uma promessa: ela decide; se recusarem o arquivo, vale o Web Audio
        if (r && typeof r.then === 'function') {
          r.then(function () { som.elOk = true; }, function () { som.elOk = false; bipe(); });
          return;
        }
        foi = true;
      } catch (e2) { foi = false; }
    }
    // iOS 9: play() n\u00e3o avisa se tocou; at\u00e9 o arquivo confirmar que toca, o Web Audio toca junto
    if (!foi || !som.elOk) { bipe(); }
  }
  function pararSom() { try { if (som.el) { som.el.pause(); } } catch (e) { /* nada */ } }

  /* ---------- alarme: o que \u00e9 problema novo ---------- */
  function lerVistos() {
    var o = {};
    try { var a = JSON.parse(ler(LS_VISTOS) || '[]'); for (var i = 0; i < a.length; i++) { o[a[i]] = true; } } catch (e) { o = {}; }
    return o;
  }
  function salvarVistos() {
    var a = [];
    for (var k in al.vistos) { if (al.vistos.hasOwnProperty(k)) { a.push(k); } }
    gravar(LS_VISTOS, JSON.stringify(a.slice(-200)));
  }
  /* cada item vermelho \u00e9 um problema; a chave inclui a hora da falha, ent\u00e3o uma falha nova do mesmo modelo toca de novo */
  function problemasAtuais() {
    var lista = [], d = m.dados, vis = gruposVisiveis(), i, j;
    if (!d) { return lista; }
    for (i = 0; i < vis.length; i++) {
      var itens = itensDo(vis[i].id);
      for (j = 0; j < itens.length; j++) {
        var it = itens[j];
        if (it && it.estado === 'erro') {
          lista.push({ chave: vis[i].id + '|' + (it.nome || '') + '|' + (it.quando || ''), grupo: vis[i].nome, nome: it.nome || '', valor: it.valor || '', detalhe: it.detalhe || '' });
        }
      }
    }
    if (dadosVelhos()) {
      var g = quando(d.gerado), semNet = m.rede === 'offline';
      lista.push({
        chave: 'parado|' + d.gerado, grupo: 'MONITOR',
        nome: semNet ? 'O iPad est\u00e1 sem internet' : 'O PC parou de enviar', valor: idadeTxt(agoraMs() - g),
        detalhe: 'Os dados est\u00e3o parados desde ' + hora(g) + (semNet ? '. Confira o Wi-Fi do iPad.' : '. Confira se o PC est\u00e1 ligado e com a Central rodando.')
      });
    }
    return lista;
  }
  function naLista(chave) {
    for (var i = 0; i < al.lista.length; i++) { if (al.lista[i].chave === chave) { return true; } }
    return false;
  }
  function verificarAlarme() {
    // s\u00f3 depois da primeira busca desta abertura: o \u00faltimo status salvo pode estar velho
    if (!m.dados || m.tentativas === 0 || m.buscando) { return; }
    var atuais = problemasAtuais(), mapa = {}, novos = [], i, k, mudou = false;
    for (i = 0; i < atuais.length; i++) { mapa[atuais[i].chave] = true; }
    if (!dadosVelhos()) {
      // o que j\u00e1 foi resolvido sai da mem\u00f3ria: se voltar a acontecer, toca de novo
      for (k in al.vistos) { if (al.vistos.hasOwnProperty(k) && !mapa[k]) { delete al.vistos[k]; mudou = true; } }
    }
    if (al.ligado && al.base) {
      // acabou de ligar: o que j\u00e1 est\u00e1 vermelho na tela n\u00e3o toca, vale o que aparecer daqui em diante
      for (i = 0; i < atuais.length; i++) { al.vistos[atuais[i].chave] = true; }
      al.base = false;
      mudou = true;
    }
    if (mudou) { salvarVistos(); }
    if (!al.ligado) { return; }
    for (i = 0; i < atuais.length; i++) { if (!al.vistos[atuais[i].chave] && !naLista(atuais[i].chave)) { novos.push(atuais[i]); } }
    if (novos.length) { dispararAlarme(novos); }
  }
  function dispararAlarme(novos) {
    for (var i = 0; i < novos.length; i++) { al.lista.push(novos[i]); }
    al.tocando = true;
    al.desde = agoraMs();
    al.ultimoSom = al.desde;
    mostrarAlerta();
    tocar();
  }
  function mostrarAlerta() {
    var n = al.lista.length, s = '', i;
    U.txt('mAlTit', n === 1 ? 'PROBLEMA NOVO' : n + ' PROBLEMAS NOVOS');
    for (i = 0; i < n && i < 5; i++) {
      var p = al.lista[i];
      s += '<div class="mali"><div class="malg">' + U.esc(p.grupo) + '</div><div class="maln">' + U.esc(p.nome) + (p.valor ? ' \u00b7 ' + U.esc(p.valor) : '') + '</div>' +
        '<div class="mald">' + U.esc(p.detalhe) + '</div></div>';
    }
    if (n > 5) { s += '<div class="mald">+ ' + (n - 5) + ' ' + U.plural(n - 5, 'outro', 'outros') + ' no Monitor</div>'; }
    U.html('mAlLista', s);
    U.txt('mAlQuando', 'Detectado \u00e0s ' + hora(al.desde) + ' \u00b7 o alarme toca at\u00e9 voc\u00ea tocar em Ciente');
    U.classe(U.$('mAlerta'), 'esc', false);
  }
  function ciente() {
    for (var i = 0; i < al.lista.length; i++) { al.vistos[al.lista[i].chave] = true; }
    salvarVistos();
    al.lista = [];
    al.tocando = false;
    pararSom();
    U.classe(U.$('mAlerta'), 'esc', true);
  }

  /* ---------- alarme: bot\u00e3o e painel ---------- */
  function renderAlarmeBotao() {
    var dot = U.$('mAlDot');
    if (dot) { dot.style.background = !al.ligado ? COR.off : (som.liberado ? COR.ok : COR.alerta); }
    U.txt('mAlDica', al.ligado && !som.liberado ? 'alarme ligado \u00b7 toque na tela para armar o som' : '');
  }
  function renderAlarmeCfg() {
    U.txt('mAlLigar', al.ligado ? 'Desligar alarme' : 'Ligar alarme');
    U.classe(U.$('mAlLigar'), 'pri', !al.ligado);
    U.txt('mAlEstado', al.ligado ? (som.liberado ? 'Alarme LIGADO \u00b7 som armado' : 'Alarme LIGADO \u00b7 toque na tela para armar o som') : 'Alarme DESLIGADO');
  }
  function mostrarAlarmeCfg(on) {
    if (on) { U.txt('mAlMsg', ''); renderAlarmeCfg(); }
    U.classe(U.$('mAlCfg'), 'esc', !on);
  }
  function alternarAlarme() {
    if (al.ligado) {
      al.ligado = false;
      gravar(LS_ALARME, null);
      if (al.tocando) { ciente(); }
      U.txt('mAlMsg', 'O Monitor continua mostrando os problemas, s\u00f3 sem som.');
    } else {
      prepararSom(true);
      al.ligado = true;
      al.base = true;
      gravar(LS_ALARME, '1');
      tocar();
      verificarAlarme();
      U.txt('mAlMsg', 'Tocou um exemplo do alarme. N\u00e3o ouviu? Aumente o volume do iPad.');
    }
    renderAlarmeCfg();
    renderAlarmeBotao();
  }
  function testarSom() {
    prepararSom(true);
    tocar();
    U.txt('mAlMsg', 'Tocou? Se n\u00e3o ouviu, aumente o volume do iPad.');
    renderAlarmeCfg();
    renderAlarmeBotao();
  }

  /* ---------- chave ---------- */
  function mostrarSetup(on) {
    U.classe(U.$('mSetup'), 'esc', !on);
    if (on) {
      U.$('mChave').value = m.chave ? formatar(m.chave) : '';
      U.txt('mSetupMsg', '');
      U.classe(U.$('mCancelar'), 'esc', !m.chave);
    }
  }
  function salvarChave() {
    var inp = U.$('mChave'), c = normalizar(inp.value);
    if (c.length !== 24) { U.txt('mSetupMsg', 'A chave tem 24 letras e n\u00fameros (6 grupos de 4). Confira e tente de novo.'); return; }
    if (m.env) {
      try { abrir(m.env, c); } catch (e) { U.txt('mSetupMsg', 'Essa chave n\u00e3o abre os dados do PC. Confira letra por letra.'); return; }
    }
    m.chave = c;
    gravar(LS_CHAVE, c);
    try { inp.blur(); } catch (e2) { /* nada */ }
    mostrarSetup(false);
    m.msg = '';
    m.rede = 'iniciando';
    m.buscando = false;
    buscar(true);
  }

  /* ---------- rel\u00f3gio ---------- */
  function tick() {
    var t = agoraMs();
    if (!m.buscando && t >= m.proxima && document.hidden !== true) { buscar(false); }
    if (t - m.ultimoRender > 30000) { render(); }
    if (al.tocando && document.hidden !== true) {
      var forte = t - al.desde < ALARME_FORTE;
      if (t - al.ultimoSom >= (forte ? REPETE_FORTE : REPETE_FRACO)) { al.ultimoSom = t; tocar(); }
    }
  }

  window.cockpitRegistrar('monitor', {
    iniciar: function (util) {
      U = util;
      m.chave = normalizar(ler(LS_CHAVE));
      var ult = ler(LS_ULTIMO);
      if (ult) {
        try { var o = JSON.parse(ult); m.dados = o.dados || null; m.recebidoEm = o.recebidoEm || 0; } catch (e) { m.dados = null; }
      }
      al.ligado = ler(LS_ALARME) === '1';
      al.vistos = lerVistos();
      U.acoes['mon-atualizar'] = function () { m.proxima = 0; buscar(true); };
      U.acoes['mon-chave'] = function () { mostrarSetup(true); };
      U.acoes['mon-salvar'] = salvarChave;
      U.acoes['mon-cancelar'] = function () { if (m.chave) { mostrarSetup(false); } };
      U.acoes['mon-grupo'] = function (id) { abrirDetalhe(id); };
      U.acoes['mon-fechar'] = fecharDetalhe;
      U.acoes['mon-pag'] = function (d) { m.pag += parseInt(d, 10) || 0; renderDetalhe(); };
      U.acoes['mon-alarme'] = function () { mostrarAlarmeCfg(true); };
      U.acoes['mon-al-ligar'] = alternarAlarme;
      U.acoes['mon-al-testar'] = testarSom;
      U.acoes['mon-al-fechar'] = function () { mostrarAlarmeCfg(false); };
      U.acoes['mon-al-ciente'] = ciente;
      for (var gi = 0; gi < GRUPOS.length; gi++) {
        var cartao = U.$('mG-' + GRUPOS[gi].id);
        if (cartao) { cartao.setAttribute('data-act', 'mon-grupo'); cartao.setAttribute('data-arg', GRUPOS[gi].id); }
      }
      var inp = U.$('mChave');
      if (inp) {
        inp.addEventListener('keydown', function (e) { if (e.keyCode === 13) { e.preventDefault(); salvarChave(); } }, false);
      }
      // com o alarme ligado, o primeiro toque em qualquer lugar arma o som (exig\u00eancia do iOS)
      var armar = function () { if (al.ligado && !som.liberado) { prepararSom(false); renderAlarmeBotao(); renderAlarmeCfg(); } };
      document.addEventListener('touchend', armar, false);
      document.addEventListener('mousedown', armar, false);
      if (!m.chave) { mostrarSetup(true); }
      document.addEventListener('visibilitychange', function () { if (!document.hidden) { m.proxima = 0; } }, false);
      if (window.applicationCache) {
        window.applicationCache.addEventListener('updateready', function () {
          try { window.applicationCache.swapCache(); } catch (e) { /* nada */ }
          window.location.reload();
        }, false);
      }
      render();
      buscar(false);
    },
    render: render,
    tick: tick
  });
})();
