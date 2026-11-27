/* Central \u00b7 Monitor (aba extra do Cockpit, vers\u00e3o web para o Safari do iPad 2).
   Busca pela internet do pr\u00f3prio iPad o status que o coletor do PC publica no GitHub,
   abre com a chave da Central (AES-256-CTR, chave = SHA-256 de "central:" + chave digitada)
   e mostra o sem\u00e1foro. Somente ES5. */
(function () {
  'use strict';

  var U = null;
  var LS_CHAVE = 'central.chave';
  var LS_ULTIMO = 'central.ultimo';
  var INTERVALO = 60000;
  var MAX_ITENS = 4;
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
  var m = { chave: '', env: null, dados: null, recebidoEm: 0, rede: 'iniciando', msg: '', buscando: false, proxima: 0, ultimoRender: 0, det: null, pag: 0 };
  var POR_PAGINA = 10;

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

  /* ---------- desenho ---------- */
  function itensDo(grupo) {
    var d = m.dados, itens = [];
    if (d && d.grupos) {
      for (var i = 0; i < d.grupos.length; i++) { if (d.grupos[i] && d.grupos[i].id === grupo) { itens = d.grupos[i].itens || []; } }
    }
    return itens;
  }
  function contar() {
    var c = { erro: 0, alerta: 0, total: 0 };
    for (var g = 0; g < GRUPOS.length; g++) {
      var it = itensDo(GRUPOS[g].id);
      for (var i = 0; i < it.length; i++) {
        c.total++;
        if (it[i].estado === 'erro') { c.erro++; } else if (it[i].estado === 'alerta') { c.alerta++; }
      }
    }
    return c;
  }
  function renderHero() {
    var d = m.dados, agora = agoraMs(), gerado = d ? quando(d.gerado) : null, c = contar();
    var limite = ((d && d.pc && d.pc.intervaloMin) || 5) * 3 * 60000;
    var velho = gerado !== null && agora - gerado > limite;
    var cor, sim, tit, sub;
    if (!d) { cor = 'off'; sim = '?'; tit = m.chave ? 'Esperando os dados do PC' : 'Monitor sem chave'; }
    else if (velho) { cor = 'erro'; sim = '!'; tit = 'O PC parou de enviar ' + idadeTxt(agora - gerado); }
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
      var g = new Date(gerado);
      sub = 'Dados do PC' + (d.pc && d.pc.nome ? ' ' + d.pc.nome : '') + ' de ' + U.hhmm(g) + ' (' + idadeTxt(agora - gerado) + ')';
      if (m.rede !== 'online' && m.msg) { sub += ' \u00b7 ' + m.msg; }
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
  function renderGrupo(g) {
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
    for (i = 0; i < itens.length && i < MAX_ITENS; i++) {
      var it = itens[i], est = COR[it.estado] ? it.estado : 'info', t = quando(it.quando);
      s += '<div class="mi ' + est + (i === 0 ? ' prim' : '') + '"><i class="md ' + est + '" style="background:' + COR[est] + '"></i>' +
        '<div class="mn">' + U.esc(it.nome || '') + '</div><div class="mv">' + U.esc(it.valor || '') + '</div>' +
        '<div class="mdt">' + U.esc(it.detalhe || '') + '</div><div class="ma">' + (t !== null ? idadeTxt(agora - t) : '') + '</div></div>';
    }
    s += '</div>';
    if (itens.length > MAX_ITENS) {
      var resto = itens.length - MAX_ITENS;
      s += '<div class="mmais">+ ' + resto + ' ' + U.plural(resto, 'outro item', 'outros itens') + ' \u00b7 toque para ver todos</div>';
    }
    U.html('mG-' + g.id, s);
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
    for (var i = 0; i < GRUPOS.length; i++) { renderGrupo(GRUPOS[i]); }
    renderDetalhe();
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
  }

  window.cockpitRegistrar('monitor', {
    iniciar: function (util) {
      U = util;
      m.chave = normalizar(ler(LS_CHAVE));
      var ult = ler(LS_ULTIMO);
      if (ult) {
        try { var o = JSON.parse(ult); m.dados = o.dados || null; m.recebidoEm = o.recebidoEm || 0; } catch (e) { m.dados = null; }
      }
      U.acoes['mon-atualizar'] = function () { m.proxima = 0; buscar(true); };
      U.acoes['mon-chave'] = function () { mostrarSetup(true); };
      U.acoes['mon-salvar'] = salvarChave;
      U.acoes['mon-cancelar'] = function () { if (m.chave) { mostrarSetup(false); } };
      U.acoes['mon-grupo'] = function (id) { abrirDetalhe(id); };
      U.acoes['mon-fechar'] = fecharDetalhe;
      U.acoes['mon-pag'] = function (d) { m.pag += parseInt(d, 10) || 0; renderDetalhe(); };
      for (var gi = 0; gi < GRUPOS.length; gi++) {
        var cartao = U.$('mG-' + GRUPOS[gi].id);
        if (cartao) { cartao.setAttribute('data-act', 'mon-grupo'); cartao.setAttribute('data-arg', GRUPOS[gi].id); }
      }
      var inp = U.$('mChave');
      if (inp) {
        inp.addEventListener('keydown', function (e) { if (e.keyCode === 13) { e.preventDefault(); salvarChave(); } }, false);
      }
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
