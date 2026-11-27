/* Central \u00b7 Monitor (aba do Cockpit, vers\u00e3o web para o Safari do iPad 2).
   Busca pela internet do pr\u00f3prio iPad o status que o coletor do PC publica no GitHub,
   abre com a chave da Central (AES-256-CTR, chave = SHA-256 de "central:" + chave digitada) e mostra:
   - o painel de sa\u00fade dos modelos do Power BI (ritmo, hist\u00f3rico, quem saiu do ritmo);
   - as ferramentas e as fontes (gateway, banco, planilhas);
   - os acontecimentos (o que falhou, parou ou voltou ao normal);
   - a ficha de cada modelo, com o erro em portugu\u00eas e o que fazer;
   - (1.8) o painel em tr\u00eas colunas: BI | servi\u00e7os (com a VM do Google sempre \u00e0 vista) e rob\u00f4s do Power Automate |
     aten\u00e7\u00e3o (o que pede olho agora, de qualquer cart\u00e3o) e acontecimentos; fichas do rob\u00f4 e da VM; mapa dos 7 dias.
   Alarme opcional: toca, fala qual foi o problema e mostra o aviso em tela cheia.
   Somente ES5. */
(function () {
  'use strict';

  var U = null;
  var LS_CHAVE = 'central.chave';
  var LS_ULTIMO = 'central.ultimo';
  var LS_ALARME = 'central.alarme';
  var LS_VISTOS = 'central.alarme.vistos';
  var LS_VOZ = 'central.voz';
  var LS_NOITE = 'central.noite';
  var LS_SIL = 'central.silencio';
  var LS_TOQUE = 'central.toque';
  var INTERVALO = 60000;
  var GRUPOS = [
    { id: 'bi', nome: 'BI' },
    { id: 'ferramentas', nome: 'FERRAMENTAS E FONTES' },
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
  var m = {
    chave: '', env: null, dados: null, recebidoEm: 0, rede: 'iniciando', msg: '', buscando: false, proxima: 0, ultimoRender: 0,
    det: null, pag: 0, tentativas: 0, ficha: -1, lista: [], novaVersao: false, proximaVersao: 0, erroInterno: '', acordadoAte: 0, noiteOn: false
  };
  var POR_PAGINA = 10;
  /* alarme: toca sem parar nos 3 primeiros minutos e depois lembra a cada 5 minutos, at\u00e9 tocar em Ciente */
  var ALARME_FORTE = 180000, REPETE_FORTE = 2600, REPETE_FRACO = 300000, REPETE_FALA = 45000;
  var al = { ligado: false, base: false, vistos: {}, tocando: false, desde: 0, ultimoSom: 0, ultimaFala: 0, falandoAte: 0, lista: [] };
  var som = { el: null, el2: null, ac: null, liberado: false, elOk: false, el2Ok: false, elErro: 0, el2Erro: 0 };
  var voz = { ok: false, ligada: true };
  var noite = { tela: false, som: false, ini: 22, fim: 6 };
  var sil = {}; // 1.7: itens silenciados pelo usu\u00e1rio (chave|estado -> at\u00e9 quando)
  var gh = { em: 0, lido: 0, ruim: false, txt: '' }; // 1.7: githubstatus.com, lido pelo iPad quando os dados n\u00e3o chegam
  var volta = { desde: 0, ate: 0 }; // 1.7: resumo "desde HH" depois de um tempo longe do iPad

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
  /* rel\u00f3gio de Bras\u00edlia, mesmo com o fuso desatualizado do iOS 9 */
  function local(ms) { var d = new Date(ms); return U.corr ? U.corr(d) : d; }
  function hora(ms) { return U.hhmm(local(ms)); }
  function meiaNoite(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
  /* 02:31 \u00b7 ontem 21:30 \u00b7 25/11 21:04 */
  function quandoTxt(ms) {
    var d = local(ms), dif = Math.round((meiaNoite(local(agoraMs())) - meiaNoite(d)) / 86400000);
    if (dif === 0) { return U.hhmm(d); }
    if (dif === 1) { return 'ontem ' + U.hhmm(d); }
    return U.pad2(d.getDate()) + '/' + U.pad2(d.getMonth() + 1) + ' ' + U.hhmm(d);
  }
  function idadeTxt(ms) {
    var min = Math.floor(Math.max(0, ms) / 60000);
    if (min < 1) { return 'agora'; }
    if (min < 60) { return 'h\u00e1 ' + min + ' min'; }
    var h = Math.floor(min / 60);
    if (h < 24) { return 'h\u00e1 ' + h + 'h' + (min % 60 ? U.pad2(min % 60) : ''); }
    var d = Math.floor(h / 24);
    return 'h\u00e1 ' + d + ' ' + U.plural(d, 'dia', 'dias');
  }
  /* 12 min \u00b7 1h07 \u00b7 3 dias */
  function durCurta(ms) {
    var min = Math.round(Math.max(0, ms) / 60000);
    if (min < 60) { return min + ' min'; }
    if (min < 2880) { return Math.floor(min / 60) + 'h' + (min % 60 ? U.pad2(min % 60) : ''); }
    return Math.round(min / 1440) + ' dias';
  }
  /* 49 s \u00b7 27 min 47 s \u00b7 1h05 */
  function durLonga(s) {
    s = Math.max(0, Math.round(s));
    if (s < 60) { return s + ' s'; }
    if (s < 3600) { return Math.floor(s / 60) + ' min' + (s % 60 ? ' ' + (s % 60) + ' s' : ''); }
    return Math.floor(s / 3600) + 'h' + U.pad2(Math.floor((s % 3600) / 60));
  }
  /* roda um peda\u00e7o do desenho sem deixar um erro nele parar a busca e o alarme */
  function seguro(nome, f) {
    try { f(); } catch (e) { m.erroInterno = nome + ': ' + String((e && e.message) || e).substr(0, 80); }
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
    m.ultStatus = status;
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
      m.msg = status > 0 ? 'Erro ' + status + ' ao buscar o status.' : (status < 0 ? 'O status demorou demais para chegar.' : 'Sem internet, ou o certificado do site n\u00e3o foi aceito.');
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
      seguro('leitura', function () { tratar(status, texto); });
      render();
    }
    try {
      x.open('GET', url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + agoraMs(), true);
      x.timeout = 20000;
      x.onreadystatechange = function () { if (x.readyState === 4) { fim(x.status, x.responseText); } };
      x.ontimeout = function () { fim(-1, ''); };
      x.onerror = function () { fim(0, ''); };
      x.send(null);
    } catch (e) { fim(0, ''); }
  }

  /* ---------- o que o PC publicou ---------- */
  function grupoDados(id) {
    var d = m.dados;
    if (d && d.grupos) {
      for (var i = 0; i < d.grupos.length; i++) { if (d.grupos[i] && d.grupos[i].id === id) { return d.grupos[i]; } }
    }
    return null;
  }
  function itensDo(id) { var g = grupoDados(id); return (g && g.itens) || []; }
  function modelosDo(id) { var g = grupoDados(id); return (g && g.modelos) || []; }
  function eventosDoPC() { return (m.dados && m.dados.eventos) || []; }
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
  /* 1.8: o coletor novo manda as marcas dos servi\u00e7os e os rob\u00f4s; a\u00ed o painel passa a ter tr\u00eas colunas */
  function versaoNum(v) { var p = String(v || '').split('.'); return (parseInt(p[0], 10) || 0) * 1000 + (parseInt(p[1], 10) || 0); }
  function painelNovo() {
    var d = m.dados, vis = gruposVisiveis();
    return !!(d && d.pc && versaoNum(d.pc.versao) >= 1008 && d.eventos && vis.length === 2 && vis[0].id === 'bi' && vis[1].id === 'ferramentas' && grupoDados('ferramentas'));
  }
  function temRobos() { var g = grupoDados('ferramentas'); return !!(g && g.robos && g.robos.length); }
  /* 2 grupos: BI alto \u00e0 esquerda; ferramentas e acontecimentos \u00e0 direita. 3 ou 4 grupos: grade 2x2 */
  function posicoes(vis) {
    var n = vis.length, pos = {}, i, temEv = !!(m.dados && m.dados.eventos);
    if (painelNovo()) {
      pos.bi = { x: 16, y: 114, w: 424, h: 552 };
      pos.srv = temRobos() ? { x: 452, y: 114, w: 272, h: 318 } : { x: 452, y: 114, w: 272, h: 552 };
      if (temRobos()) { pos.rob = { x: 452, y: 444, w: 272, h: 222 }; }
      pos.at = { x: 736, y: 114, w: 272, h: 318 };
      pos.ev = { x: 736, y: 444, w: 272, h: 222 };
      return pos;
    }
    if (n <= 2 && temEv) {
      pos[vis[0].id] = { x: 16, y: 114, w: 488, h: 552 };
      if (n === 2) { pos[vis[1].id] = { x: 520, y: 114, w: 488, h: 296 }; pos.ev = { x: 520, y: 422, w: 488, h: 244 }; }
      else { pos.ev = { x: 520, y: 114, w: 488, h: 552 }; }
      return pos;
    }
    for (i = 0; i < n; i++) {
      var alto = n <= 2, largo = n === 1 || (n === 3 && i === 2 && !temEv);
      pos[vis[i].id] = { x: largo || i % 2 === 0 ? 16 : 520, y: alto || i < 2 ? 114 : 396, w: largo ? 992 : 488, h: alto ? 552 : 270 };
    }
    if (n === 3 && temEv) { pos.ev = { x: 520, y: 396, w: 488, h: 270 }; }
    return pos;
  }
  function contar() {
    var c = { erro: 0, alerta: 0, total: 0 }, vis = gruposVisiveis();
    for (var g = 0; g < vis.length; g++) {
      var it = itensDo(vis[g].id);
      for (var i = 0; i < it.length; i++) {
        c.total++;
        if (it[i].estado === 'erro') { c.erro++; } else if (it[i].estado === 'alerta' && !silenciado(it[i])) { c.alerta++; }
      }
    }
    return c;
  }
  function dadosVelhos() {
    var d = m.dados, gerado = d ? quando(d.gerado) : null;
    if (gerado === null) { return false; }
    return agoraMs() - gerado > ((d.pc && d.pc.intervaloMin) || 5) * 3 * 60000;
  }

  /* ---------- silenciar (1.7): o que j\u00e1 se sabe sai da contagem at\u00e9 mudar de estado ou o prazo acabar ---------- */
  function lerSil() {
    var o = null, t = agoraMs(), k;
    sil = {};
    try { o = JSON.parse(ler(LS_SIL) || '{}'); } catch (e) { o = null; }
    if (o) { for (k in o) { if (o.hasOwnProperty(k) && o[k] > t) { sil[k] = o[k]; } } }
  }
  function chaveSil(it) { return (it.ks || it.chave || it.nome || '') + '|' + it.estado; }
  function podeSilenciar(it) { return !!it && !it.m && !it.modelo && (it.estado === 'alerta' || it.estado === 'info'); }
  function silenciado(it) {
    if (!podeSilenciar(it)) { return 0; }
    var a = sil[chaveSil(it)];
    return a && a > agoraMs() ? a : 0;
  }
  function silenciar(it, dias) {
    if (!podeSilenciar(it)) { return; }
    if (dias > 0) { sil[chaveSil(it)] = agoraMs() + dias * 86400000; } else { delete sil[chaveSil(it)]; }
    gravar(LS_SIL, JSON.stringify(sil));
  }

  /* ---------- de volta ao iPad (1.7): o que aconteceu enquanto voc\u00ea estava longe ---------- */
  function voltou() {
    var t = agoraMs(), ult = parseInt(ler(LS_TOQUE), 10) || 0;
    if (ult && ult < t && t - ult >= 3 * 3600000) { volta.desde = ult; volta.ate = t + 300000; }
    if (t - ult > 60000) { gravar(LS_TOQUE, String(t)); }
  }
  function voltaTxt() {
    var d = m.dados, g = grupoDados('bi') || {}, r = g.resumo || {}, hh = r.hh, ger = d ? quando(d.gerado) : null, i;
    if (!volta.ate || agoraMs() > volta.ate || !hh || hh.length !== 24 || ger === null) { return ''; }
    var hFim = Math.floor(ger / 3600000), hIni = Math.floor(volta.desde / 3600000), ok = 0, f = 0, ne = 0;
    for (i = 0; i < 24; i++) { if (hFim - 23 + i >= hIni) { ok += hh[i][0]; f += hh[i][1]; } }
    var evs = eventosDoPC();
    for (i = 0; i < evs.length; i++) { var te = quando(evs[i].t); if (te !== null && te >= volta.desde && evs[i].n !== 'info') { ne++; } }
    return (hFim - hIni > 23 ? 'Nas \u00faltimas 24h' : 'Desde as ' + horaDe(volta.desde)) + ': ' + ok + ' ' + U.plural(ok, 'atualiza\u00e7\u00e3o certa', 'atualiza\u00e7\u00f5es certas') + ' \u00b7 ' +
      f + ' ' + U.plural(f, 'falha', 'falhas') + (ne ? ' \u00b7 ' + ne + ' ' + U.plural(ne, 'acontecimento', 'acontecimentos') : '');
  }
  /* githubstatus.com, lido pelo pr\u00f3prio iPad quando os dados n\u00e3o chegam: separa "o PC parou" de "o GitHub est\u00e1 com problema" */
  var GH_PARTE = { Pages: 'site do app', 'Git Operations': 'envio do status', 'API Requests': 'API' };
  var GH_EST = { degraded_performance: 'lentid\u00e3o', partial_outage: 'falha parcial', major_outage: 'falha geral', under_maintenance: 'manuten\u00e7\u00e3o' };
  function verGithub() {
    var t = agoraMs();
    if (t - gh.em < 300000) { return; }
    gh.em = t;
    var x = new XMLHttpRequest();
    try {
      x.open('GET', 'https://www.githubstatus.com/api/v2/summary.json', true);
      x.timeout = 15000;
      x.onreadystatechange = function () {
        if (x.readyState !== 4) { return; }
        seguro('github', function () {
          if (x.status !== 200) { return; }
          var o = JSON.parse(x.responseText), c = (o && o.components) || [], l = [], i;
          for (i = 0; i < c.length; i++) {
            if (GH_PARTE[c[i].name] && c[i].status !== 'operational') { l.push(GH_PARTE[c[i].name] + ' com ' + (GH_EST[c[i].status] || c[i].status)); }
          }
          gh.lido = agoraMs(); gh.ruim = l.length > 0; gh.txt = l.join(' \u00b7 ');
          renderHero();
        });
      };
      x.send(null);
    } catch (e) { /* sem diagn\u00f3stico */ }
  }
  function ghRecente() { return gh.lido && agoraMs() - gh.lido < 900000; }

  /* ---------- topo ---------- */
  function saudacao() {
    var h = local(agoraMs()).getHours();
    return h >= 5 && h < 12 ? 'Bom dia' : (h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite');
  }
  function estadoGeral() {
    var d = m.dados, c = contar();
    if (!d) { return { cor: 'off', c: c }; }
    if (dadosVelhos()) { return { cor: 'erro', velho: true, c: c }; }
    return { cor: c.erro ? 'erro' : (c.alerta ? 'alerta' : 'ok'), c: c };
  }
  function renderHero() {
    var d = m.dados, agora = agoraMs(), gerado = d ? quando(d.gerado) : null, e = estadoGeral(), c = e.c;
    var sim, tit, sub;
    if (!d) { sim = '?'; tit = m.chave ? 'Esperando os dados do PC' : 'Monitor sem chave'; }
    else if (e.velho) {
      sim = '!';
      if (ghRecente() && gh.ruim) { tit = 'GitHub inst\u00e1vel \u00b7 dados de ' + hora(gerado); }
      else if (m.rede === 'offline') { tit = ghRecente() ? 'iPad n\u00e3o abre o status' : 'iPad sem internet ' + idadeTxt(agora - gerado); }
      else { tit = 'O PC parou de enviar ' + idadeTxt(agora - gerado); }
    }
    else if (c.erro) {
      // um problema s\u00f3 (ou v\u00e1rios com a mesma causa): o topo j\u00e1 diz qual \u00e9
      var probs = problemasAtuais();
      sim = '!';
      if (probs.length === 1) { tit = probs[0].nome + (probs[0].valor ? ' \u00b7 ' + probs[0].valor : ''); }
      else { tit = c.erro + ' ' + U.plural(c.erro, 'problema', 'problemas') + (c.alerta ? ' \u00b7 ' + c.alerta + ' ' + U.plural(c.alerta, 'alerta', 'alertas') : ''); }
    } else if (c.alerta) { sim = '!'; tit = c.alerta + ' ' + U.plural(c.alerta, 'ponto de aten\u00e7\u00e3o', 'pontos de aten\u00e7\u00e3o'); }
    else { sim = '\u2713'; tit = d.nome ? saudacao() + ', ' + d.nome + ' \u00b7 tudo certo' : 'Tudo certo'; }
    var sem = U.$('mSem');
    sem.style.background = COR[e.cor];
    sem.style.boxShadow = e.cor === 'off' ? 'none' : '0 0 22px ' + COR[e.cor];
    U.txt('mSem', sim);
    U.txt('mTit', tit);
    if (d && gerado !== null) {
      sub = 'Dados do PC' + (d.pc && d.pc.nome ? ' ' + d.pc.nome : '') + ' de ' + hora(gerado) + ' (' + idadeTxt(agora - gerado) + ')';
      var vt = voltaTxt();
      if (gerado - agora > 300000) { sub = 'O rel\u00f3gio do iPad est\u00e1 atrasado: ligue Ajustes \u203a Geral \u203a Data e Hora \u203a Autom\u00e1tico'; }
      else if (e.velho && ghRecente() && gh.ruim) { sub = 'githubstatus.com: ' + gh.txt; }
      else if (e.velho && ghRecente() && m.rede === 'offline') {
        sub = m.ultStatus === 0 ? 'Internet e GitHub ok: prov\u00e1vel falta da raiz Let\u2019s Encrypt no iPad' : 'Internet e GitHub ok \u00b7 ' + m.msg;
      }
      else if (e.velho && ghRecente() && m.rede === 'online') { sub = 'GitHub normal: o PC est\u00e1 desligado, sem internet ou o coletor parou'; }
      else if (m.rede !== 'online' && m.msg) { sub += ' \u00b7 ' + m.msg; }
      else if (vt) { sub = vt; }
    } else {
      sub = m.msg || (m.chave ? 'Buscando o status publicado pelo PC\u2026' : 'Toque em Chave e digite a chave da Central.');
    }
    U.txt('mSub', sub);
    var r = REDE[m.rede] || REDE.erro;
    U.html('mRede', '<span class="pill ' + r[0] + '">' + r[1] + '</span>');
    U.classe(U.$('pg-monitor'), 'velho', !!e.velho);
    var dot = U.$('tabMonDot');
    if (dot) { dot.style.background = COR[e.cor]; }
    U.txt('mAtualizar', m.novaVersao ? 'Nova vers\u00e3o' : 'Atualizar');
    U.classe(U.$('mAtualizar'), 'pri', m.novaVersao);
  }

  /* ---------- cart\u00f5es ---------- */
  function pillDe(itens) {
    var nErro = 0, nAlerta = 0, nAtivos = 0, i;
    for (i = 0; i < itens.length; i++) {
      if (itens[i].estado === 'erro') { nErro++; } else if (itens[i].estado === 'alerta' && !silenciado(itens[i])) { nAlerta++; }
      if (itens[i].estado !== 'off') { nAtivos++; }
    }
    return nErro ? ['vermelho', nErro + ' ' + U.plural(nErro, 'PROBLEMA', 'PROBLEMAS')] :
      (nAlerta ? ['ambar', nAlerta + ' ' + U.plural(nAlerta, 'ALERTA', 'ALERTAS')] :
      (nAtivos ? ['verde', 'OK'] : ['cinza', itens.length ? 'EM BREVE' : '\u2014']));
  }
  function cabeca(titulo, pill) {
    return '<div class="mgt">' + U.esc(titulo) + '</div><div class="mgr"><span class="pill pq ' + pill[0] + '">' + pill[1] + '</span></div>';
  }
  function ordenar(itens) {
    var l = itens.slice(0), i;
    for (i = 0; i < l.length; i++) { l[i]._o = i; }
    l.sort(function (a, b) { return (pesoItem(b) - pesoItem(a)) || (a._o - b._o); });
    return l;
  }
  /* aviso de fundo (b): informa, mas n\u00e3o tira do cart\u00e3o quem mostra que est\u00e1 tudo funcionando */
  function pesoItem(it) {
    if (silenciado(it)) { return 0.4; }
    return it.b && (it.estado === 'info' || it.estado === 'ok') ? 0.5 : (PESO[it.estado] || 0);
  }
  function linhaItem(it, primeira, agora, extra) {
    var est = COR[it.estado] ? it.estado : 'info', t = quando(it.quando), ate = silenciado(it);
    return '<div class="mi ' + est + (primeira ? ' prim' : '') + (ate ? ' sil' : '') + '"' + (extra || '') + '><i class="md ' + est + '" style="background:' + COR[est] + '"></i>' +
      '<div class="mn">' + U.esc(it.nome || '') + '</div><div class="mv">' + U.esc(it.valor || '') + '</div>' +
      '<div class="mdt">' + (ate ? 'silenciado at\u00e9 ' + quandoTxt(ate) + ' \u00b7 ' : '') + U.esc(it.detalhe || '') + '</div><div class="ma">' + (t !== null ? idadeTxt(agora - t) : '') + '</div></div>';
  }
  /* cart\u00e3o comum: linhas altas (nome, valor, detalhe) ou compactas (nome e valor) */
  function renderGrupo(g, p, compacto) {
    var agora = agoraMs(), itens = ordenar(itensDo(g.id)), i, alt = compacto ? 36 : 50;
    var max = Math.max(1, Math.floor((p.h - (compacto ? 64 : 66)) / alt));
    var s = cabeca(g.nome, pillDe(itens)) + '<div class="mlista">';
    if (!itens.length) { s += '<div class="mvazio">' + (m.dados ? 'Nada para mostrar aqui.' : 'Sem dados ainda.') + '</div>'; }
    for (i = 0; i < itens.length && i < max; i++) {
      if (!compacto) { s += linhaItem(itens[i], i === 0, agora); continue; }
      var it = itens[i], est = COR[it.estado] ? it.estado : 'info';
      s += '<div class="mc ' + est + (i === 0 ? ' prim' : '') + (silenciado(it) ? ' sil' : '') + '"><i class="md ' + est + '" style="background:' + COR[est] + '"></i>' +
        '<div class="mcn">' + U.esc(it.nome || '') + '</div><div class="mcv">' + U.esc(it.valor || '') + '</div></div>';
    }
    s += '</div>';
    if (itens.length > max) {
      var resto = itens.length - max;
      s += '<div class="mmais">+ ' + resto + ' ' + U.plural(resto, 'outro item', 'outros itens') + ' \u00b7 toque para ver todos</div>';
    } else if (compacto && itens.length) { s += '<div class="mmais">toque para ver os detalhes</div>'; }
    U.html('mG-' + g.id, s);
  }

  /* ---------- painel de sa\u00fade dos modelos ---------- */
  function statusModelo(mo, agora) {
    var ini = quando(mo.ini), fim = quando(mo.fim), prev = quando(mo.prev);
    if (mo.sit === 'ok') { return { txt: fim !== null ? quandoTxt(fim) : (mo.txt || ''), cls: '' }; }
    if (mo.sit === 'rodando') {
      // passou do pr\u00f3prio intervalo: o hor\u00e1rio seguinte da agenda est\u00e1 sendo pulado
      if (intervaloS(mo) && ini !== null && agora - ini >= intervaloS(mo) * 1000) { return { txt: 'atualizando ' + durCurta(agora - ini), cls: 'alerta' }; }
      if (prev !== null && agora > prev + 60000) { return { txt: 'terminando\u2026', cls: 'azul' }; }
      return { txt: ini !== null && mo.medS >= 300 ? 'atualizando ' + durCurta(agora - ini) : 'atualizando', cls: 'azul' };
    }
    if (mo.sit === 'lento' || mo.sit === 'travado') { return { txt: (mo.sit === 'lento' ? 'lento \u00b7 ' : 'travado \u00b7 ') + (ini !== null ? durCurta(agora - ini) : ''), cls: mo.estado }; }
    if (mo.sit === 'atrasado') { return { txt: fim !== null ? 'parado h\u00e1 ' + durCurta(agora - fim) : (mo.txt || ''), cls: mo.estado }; }
    return { txt: mo.txt || '', cls: mo.estado === 'off' ? 'off' : mo.estado };
  }
  var COR_BARRA = { C: '#2f9e68', F: '#ff7a7a', X: '#f59e0b', U: '#7fc4ff', D: '#4b6284' };
  /* intervalo da agenda em segundos, s\u00f3 para quem tem hor\u00e1rio marcado v\u00e1rias vezes por dia (o coletor manda os hor\u00e1rios pulados) */
  function intervaloS(mo) { return mo && mo.pul && mo.cad && mo.cad <= 180 ? Math.round(mo.cad * 60) : 0; }
  /* barrinhas das \u00faltimas atualiza\u00e7\u00f5es: a mais nova \u00e0 direita; altura = tempo que levou; vermelho = falhou;
     amarelo = deu certo, mas levou quase o intervalo inteiro (limS); escMin = a escala vai pelo menos at\u00e9 esse tempo */
  function barras(h, quantas, larg, vao, altMax, limS, escMin) {
    var l = (h || []).slice(0, quantas), max = escMin || 1, i, s = '';
    for (i = 0; i < l.length; i++) { if (l[i][2] > max) { max = l[i][2]; } }
    for (i = 0; i < l.length; i++) {
      var e = l[i], rodando = e[0] === 'U';
      var alt = rodando ? altMax : Math.max(3, Math.round(altMax * e[2] / max));
      var x = (quantas - 1 - i) * (larg + vao);
      var cor = e[0] === 'C' && limS && e[2] >= 0.9 * limS ? '#f59e0b' : (COR_BARRA[e[0]] || '#4b6284');
      s += '<i' + (rodando ? ' class="rod"' : '') + ' style="left:' + x + 'px;height:' + alt + 'px;width:' + larg + 'px;background:' + cor + '"></i>';
    }
    return s;
  }
  function pastaUnica(mods) {
    var p = mods.length ? (mods[0].pasta || '') : '', i;
    for (i = 1; i < mods.length; i++) { if ((mods[i].pasta || '') !== p) { return ''; } }
    return p;
  }
  function ordenarModelos(mods) {
    var l = mods.slice(0), i;
    for (i = 0; i < l.length; i++) { l[i]._o = i; }
    l.sort(function (a, b) { return ((PESO[b.estado] || 0) - (PESO[a.estado] || 0)) || (a._o - b._o); });
    return l;
  }
  function renderSaude(g, p) {
    var agora = agoraMs(), grupo = grupoDados(g.id) || {}, mods = modelosDo(g.id), r = grupo.resumo || null, i;
    var pasta = pastaUnica(mods), itens = itensDo(g.id), pill = pillDe(itens), fino = p.w < 450;
    var max = Math.floor((p.h - 64 - 24) / 27), lista = mods.length > max ? ordenarModelos(mods).slice(0, max - 1) : mods;
    var s = cabeca(g.nome + (pasta ? ' \u00b7 ' + pasta.toUpperCase() : ''), pill);
    U.classe(U.$('mG-' + g.id), 'est', fino);
    var res = '', dia = '';
    if (r) {
      var limTxt = r.lim ? ' \u00b7 ' + r.lim + ' no limite' : '';
      var rodTxt = r.rod ? ' \u00b7 ' + r.rod + ' atualizando' + (limTxt ? '' : ' agora') : '';
      var parTxt = r.parados ? ' \u00b7 ' + r.parados + ' ' + U.plural(r.parados, 'parado', 'parados') : '';
      res = r.ok + ' de ' + r.total + ' no ritmo' + limTxt + rodTxt + parTxt;
      if (res.length > 44) { res = r.ok + ' no ritmo' + limTxt + rodTxt + parTxt; }
      if (fino) {
        // na coluna estreita cabe menos: fica o que importa primeiro
        res = r.ok + ' de ' + r.total + ' no ritmo' + parTxt + limTxt + (r.rod ? ' \u00b7 ' + r.rod + ' atualizando' : '');
        if (res.length > 36) { res = r.ok + ' de ' + r.total + ' no ritmo' + parTxt + limTxt; }
        if (res.length > 36) { res = r.ok + ' de ' + r.total + ' no ritmo' + parTxt; }
      }
      if (r.h24 && (r.h24[0] || r.h24[1])) { dia = '24h: ' + r.h24[0] + ' certas \u00b7 ' + r.h24[1] + ' ' + U.plural(r.h24[1], 'falha', 'falhas'); }
    }
    var temMapa = false;
    for (i = 0; i < mods.length; i++) { if (mods[i].faixa && mods[i].faixa.length === 24) { temMapa = true; } }
    s += '<div class="mres">' + U.esc(res) + '</div><div class="mres24' + (r && r.h24 && r.h24[1] ? ' ruim' : '') + (temMapa ? ' lnk' : '') + '"' + (temMapa ? ' data-act="mon-mapa"' : '') + '>' + U.esc(dia) + (temMapa && dia ? ' \u203a' : '') + '</div><div class="mgrade">';
    for (i = 0; i < lista.length; i++) {
      var mo = lista[i], est = COR[mo.estado] ? mo.estado : 'info', st = statusModelo(mo, agora);
      s += '<div class="mm ' + est + '"><i class="md ' + est + (mo.lim && est === 'ok' ? ' lim' : '') + '" style="background:' + COR[est] + '"></i><div class="mmn">' + U.esc(mo.nome || '') + '</div>' +
        '<div class="mmb">' + barras(mo.h, fino ? 9 : 12, 5, 2, 17, intervaloS(mo)) + '</div><div class="mmt ' + st.cls + '">' + U.esc(st.txt) + '</div></div>';
    }
    s += '</div>';
    s += '<div class="mmais">' + (mods.length > lista.length ? '+ ' + (mods.length - lista.length) + ' outros modelos \u00b7 ' : '') +
      (r && r.lim ? (fino ? 'anel amarelo = no limite \u00b7 ' : 'anel amarelo = no limite do ritmo \u00b7 ') : '') +
      (temMapa ? (fino ? 'toque em 24h: mapa do dia e dos 7 dias' : 'toque em 24h para ver o mapa do dia') : 'toque para abrir a ficha de cada modelo') + '</div>';
    U.html('mG-' + g.id, s);
  }

  /* ---------- acontecimentos ---------- */
  function renderEventos(p) {
    var el = U.$('mEv'), evs = eventosDoPC(), i;
    if (!el) { return; }
    if (!p) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; el.style.width = p.w + 'px'; el.style.height = p.h + 'px';
    var estreito = p.w < 300, max = Math.max(1, Math.floor((p.h - 44 - 22) / (estreito ? 38 : 40))), dia = agoraMs() - 86400000, n24 = 0, antigo = null, topo = '';
    for (i = 0; i < evs.length; i++) {
      var t0 = quando(evs[i].t);
      if (t0 === null) { continue; }
      if (antigo === null || t0 < antigo) { antigo = t0; }
      if (t0 >= dia && evs[i].n !== 'info') { n24++; }
    }
    // o registro pode ter come\u00e7ado h\u00e1 menos de um dia: a\u00ed n\u00e3o d\u00e1 para afirmar nada sobre as 24 horas
    if (n24) { topo = n24 + (estreito ? ' em 24h' : ' nas \u00faltimas 24h'); }
    else if (antigo !== null) { topo = estreito ? 'nada novo' : (antigo > dia ? 'nada novo desde ' + quandoTxt(antigo) : 'nada novo nas \u00faltimas 24h'); }
    var s = '<div class="mgt">ACONTECIMENTOS</div><div class="mgr mgr2">' + topo + '</div><div class="mlista">';
    if (!evs.length) { s += '<div class="mvazio">Nada por enquanto. O Monitor anota aqui quando algo falha, para ou volta ao normal.</div>'; }
    for (i = 0; i < evs.length && i < max; i++) {
      var e = evs[i], est = COR[e.n] ? e.n : 'info', t = quando(e.t);
      if (estreito) {
        s += '<div class="me2' + (i === 0 ? ' prim' : '') + '"><i class="md ' + est + '" style="background:' + COR[est] + '"></i><div class="me2x"><span>' + (t !== null ? quandoTxt(t) : '') + '</span>' + U.esc(e.x || '') + '</div></div>';
        continue;
      }
      s += '<div class="me' + (i === 0 ? ' prim' : '') + '"><div class="meh">' + (t !== null ? quandoTxt(t) : '') + '</div><i class="md ' + est + '" style="background:' + COR[est] + '"></i>' +
        '<div class="mex">' + U.esc(e.x || '') + '</div><div class="med">' + U.esc(e.d || '') + '</div></div>';
    }
    s += '</div>';
    if (evs.length > max) { s += '<div class="mmais">+ ' + (evs.length - max) + (estreito ? ' \u00b7 toque para ver todos' : ' mais antigos \u00b7 toque para ver todos') + '</div>'; }
    U.html('mEv', s);
  }

  /* ---------- 1.8: servi\u00e7os, rob\u00f4s e aten\u00e7\u00e3o ---------- */
  var DIA_C = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 's\u00e1b'];
  var COR_Q = { C: '#2f9e68', F: '#ff7a7a', X: '#4b6284', U: '#7fc4ff' };
  var EXT_ORDEM = ['Microsoft', 'GitHub', 'Google', 'Claude', 'SEFAZ'];
  function colocar(el, p) {
    if (!el) { return false; }
    if (!p) { el.style.display = 'none'; return false; }
    el.style.display = 'block';
    el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; el.style.width = p.w + 'px'; el.style.height = p.h + 'px';
    return true;
  }
  function pctTxt(v) { return String(v).replace('.', ',') + '%'; }
  function segTxt(ms) { return (ms >= 9950 ? String(Math.round(ms / 1000)) : String(Math.round(ms / 100) / 10).replace('.', ',')) + ' s'; }
  /* hoje 16:18 \u00b7 amanh\u00e3 07:18 \u00b7 seg 08:00 \u00b7 07/12 08:00 */
  function diaTxt(ms) {
    var d = local(ms), dif = Math.round((meiaNoite(d) - meiaNoite(local(agoraMs()))) / 86400000);
    if (dif === 0) { return 'hoje ' + U.hhmm(d); }
    if (dif === 1) { return 'amanh\u00e3 ' + U.hhmm(d); }
    if (dif === -1) { return 'ontem ' + U.hhmm(d); }
    if (dif > -7 && dif < 7) { return DIA_C[d.getDay()] + ' ' + U.hhmm(d); }
    return U.pad2(d.getDate()) + '/' + U.pad2(d.getMonth() + 1) + ' ' + U.hhmm(d);
  }
  function robosDados() { var g = grupoDados('ferramentas'); return (g && g.robos) || []; }
  function roboDe(id) {
    var l = robosDados(), i;
    for (i = 0; i < l.length; i++) { if (l[i].id === id) { return l[i]; } }
    return null;
  }
  function sitRobo(r) {
    if (r.estado === 'off') { return ['cinza', 'DESLIGADO']; }
    if (r.sit === 'falhou') { return [r.estado === 'erro' ? 'vermelho' : 'ambar', 'FALHOU']; }
    if (r.sit === 'atrasado') { return ['ambar', 'N\u00c3O RODOU']; }
    if (r.sit === 'lento') { return ['ambar', 'DEMORANDO']; }
    if (r.sit === 'suspenso') { return ['ambar', 'SUSPENSO']; }
    if (r.sit === 'semexec') { return ['cinza', 'SEM EXECU\u00c7\u00c3O']; }
    if (r.sit === 'rodando') { return ['ciano', 'RODANDO']; }
    return ['verde', 'EM DIA'];
  }
  /* nome que cabe na linha do cart\u00e3o: sem "FLUXO" na frente nem o dia da semana no fim; se ainda sobrar, corta o meio e guarda a \u00faltima palavra */
  function nomeRobo(nome, max) {
    var n = String(nome || '').replace(/^FLUXO\s+/i, '').replace(/\s+-\s+(SEGUNDA|TER[\u00c7C]A|QUARTA|QUINTA|SEXTA)-FEIRA$/i, '').replace(/\s+-\s+(S[\u00c1A]BADO|DOMINGO)$/i, '');
    if (n.length <= max) { return n; }
    var i = n.lastIndexOf(' '), ult = i > 0 ? n.slice(i + 1) : '';
    if (!ult || ult.length > 9 || max - ult.length - 2 < 6) { return n.slice(0, max - 1) + '\u2026'; }
    return n.slice(0, max - ult.length - 2).replace(/\s+$/, '') + '\u2026 ' + ult;
  }
  /* os pilares do cart\u00e3o de servi\u00e7os: itens marcados pelo coletor (p), juntando os de mesmo nome (ex.: o banco SQL visto pelos dois gateways) */
  var ORD_P = [/^VM /, /^Bot /, /^Gateway/, /^Banco/, /^Pain/, /^Planilhas/, /^PC /];
  function pilares() {
    var itens = itensDo('ferramentas'), l = [], por = {}, i, j, k;
    for (i = 0; i < itens.length; i++) {
      var it = itens[i];
      if (!it.p) { continue; }
      if (!por[it.p]) { por[it.p] = { nome: it.p, itens: [], o: l.length, ord: ORD_P.length }; l.push(por[it.p]); }
      por[it.p].itens.push(it);
    }
    for (i = 0; i < l.length; i++) {
      var pior = l[i].itens[0];
      for (j = 1; j < l[i].itens.length; j++) { if ((PESO[l[i].itens[j].estado] || 0) > (PESO[pior.estado] || 0)) { pior = l[i].itens[j]; } }
      l[i].it = pior;
      l[i].estado = COR[pior.estado] ? pior.estado : 'info';
      l[i].valor = pior.pv || pior.valor || '';
      for (k = ORD_P.length - 1; k >= 0; k--) { if (ORD_P[k].test(l[i].nome)) { l[i].ord = k; } }
    }
    l.sort(function (a, b) { return (a.ord - b.ord) || (a.o - b.o); });
    return l;
  }
  /* uso da VM numa linha: CPU 6% \u00b7 mem\u00f3ria 75% \u00b7 disco 30% (\u00e2mbar/vermelho quando aperta); vazio se a leitura for velha */
  function usoCurto(mq) {
    var l = [], lido = mq ? quando(mq.lido) : null;
    if (!mq || lido === null || agoraMs() - lido > 1800000) { return ''; }
    function parte(txt, nivel) { return '<span' + (nivel ? ' class="' + nivel + '"' : '') + '>' + txt + '</span>'; }
    if (typeof mq.cpu === 'number') { l.push(parte('CPU ' + Math.round(mq.cpu) + '%', mq.cpu >= 85 ? 'am' : '')); }
    if (mq.mem) { l.push(parte('mem\u00f3ria ' + mq.mem[0] + '%', mq.mem[2] < 0.1 * mq.mem[1] ? 'ru' : (mq.mem[0] >= 85 || (mq.swap && mq.swap[0] > 0.8 * mq.swap[1]) ? 'am' : ''))); }
    if (mq.disco) { l.push(parte('disco ' + mq.disco[0] + '%', mq.disco[0] >= 95 ? 'ru' : (mq.disco[0] >= 85 ? 'am' : ''))); }
    return l.join(' \u00b7 ');
  }
  function externos() {
    var itens = itensDo('ferramentas'), l = [], i, k;
    for (k = 0; k < EXT_ORDEM.length; k++) { for (i = 0; i < itens.length; i++) { if (itens[i].x === EXT_ORDEM[k]) { l.push(itens[i]); break; } } }
    for (i = 0; i < itens.length; i++) { if (itens[i].x && l.indexOf(itens[i]) < 0) { l.push(itens[i]); } }
    return l;
  }
  function renderServicos(p) {
    var el = U.$('mSrv'), i, k;
    if (!colocar(el, p)) { return; }
    var pil = pilares(), ext = externos(), conta = [], y = 38;
    for (i = 0; i < pil.length; i++) { conta.push(pil[i].it); }
    for (i = 0; i < ext.length; i++) { conta.push(ext[i]); }
    var s = cabeca('SERVI\u00c7OS', pillDe(conta)) + '<div class="mlista" style="top:38px">';
    if (!pil.length) { s += '<div class="mvazio">Sem dados dos servi\u00e7os ainda.</div>'; y += 60; }
    for (i = 0; i < pil.length; i++) {
      var q = pil[i], vm = q.it.vm, est = q.estado, uso = vm ? usoCurto(vm.maq) : '';
      s += '<div class="ms1 ' + est + (i === 0 ? ' prim' : '') + (vm ? (uso ? ' vm vm2' : ' vm') : '') + '" data-act="mon-abrir" data-arg="' + U.esc(q.it.chave || q.it.nome || '') + '"><i class="md ' + est + '" style="background:' + COR[est] + '"></i>' +
        '<div class="msv">' + U.esc(q.valor) + '</div><div class="msn">' + U.esc(q.nome) + '</div>';
      if (vm) {
        // a VM do Google: as \u00faltimas 24 horas, hora a hora (a mais nova \u00e0 direita), e a disponibilidade
        s += '<div class="msfx">';
        for (k = 0; k < 24; k++) { s += '<i style="left:' + (k * 6) + 'px;background:' + (COR_FX[String(vm.fx || '').charAt(k)] || '#0e2238') + '"></i>'; }
        s += '</div><div class="msup">' + (vm.up !== null && vm.up !== undefined ? pctTxt(vm.up) + ' 24h' : '') + '</div>';
        if (uso) { s += '<div class="msuso">' + uso + '</div>'; }
      }
      s += '</div>';
      y += vm ? (uso ? 62 : 46) : 24;
    }
    s += '</div>';
    // quem \u00e9 de fora: uma bolinha para cada (Microsoft, GitHub, Google, Claude, SEFAZ)
    if (ext.length) {
      s += '<div class="msrot" style="top:' + (y + 9) + 'px">DE FORA</div>';
      for (i = 0; i < ext.length && i < 6; i++) {
        var e = ext[i], ee = COR[e.estado] ? e.estado : 'info';
        s += '<div class="msx ' + ee + '" style="left:' + (18 + (i % 3) * 82) + 'px;top:' + (y + 24 + Math.floor(i / 3) * 20) + 'px" data-act="mon-abrir" data-arg="' + U.esc(e.chave || e.nome || '') + '">' +
          '<i class="md ' + ee + '" style="background:' + COR[ee] + '"></i><span>' + U.esc(e.x) + '</span></div>';
      }
      y += 24 + Math.ceil(Math.min(ext.length, 6) / 3) * 20;
    }
    // sem o cart\u00e3o dos rob\u00f4s sobra espa\u00e7o: entram as outras ferramentas
    var resto = [], itens = ordenar(itensDo('ferramentas')), cabem = Math.floor((p.h - y - 44) / 24);
    for (i = 0; i < itens.length; i++) { if (!itens[i].p && !itens[i].x && !itens[i].rb) { resto.push(itens[i]); } }
    if (cabem >= 2 && resto.length) {
      s += '<div class="msrot" style="top:' + (y + 12) + 'px">OUTRAS FERRAMENTAS</div><div class="mlista" style="top:' + (y + 28) + 'px">';
      for (i = 0; i < resto.length && i < cabem; i++) {
        var o = resto[i], oe = COR[o.estado] ? o.estado : 'info';
        s += '<div class="ms1 ' + oe + (i === 0 ? ' prim' : '') + (silenciado(o) ? ' sil' : '') + '" data-act="mon-abrir" data-arg="' + U.esc(o.chave || o.nome || '') + '"><i class="md ' + oe + '" style="background:' + COR[oe] + '"></i>' +
          '<div class="msv">' + U.esc(o.valor || '') + '</div><div class="msn">' + U.esc(o.nome || '') + '</div></div>';
      }
      s += '</div><div class="mmais">toque para ver todas</div>';
    }
    U.html('mSrv', s);
  }
  function ordemRobos(l) {
    var r = l.slice(0), i;
    function peso(x) { return x.estado === 'erro' ? 5 : (x.estado === 'alerta' ? 4 : (x.sit === 'rodando' ? 3 : (x.estado === 'off' ? 0 : 2))); }
    function ult(x) { return x.h && x.h.length ? x.h[0][1] : 0; }
    for (i = 0; i < r.length; i++) { r[i]._o = i; }
    r.sort(function (a, b) { return (peso(b) - peso(a)) || (ult(b) - ult(a)) || (a._o - b._o); });
    return r;
  }
  function itensDosRobos() {
    var itens = itensDo('ferramentas'), l = [], i;
    for (i = 0; i < itens.length; i++) { if (itens[i].rb || /^rb\|/.test(itens[i].chave || '')) { l.push(itens[i]); } }
    return l;
  }
  function renderRobos(p) {
    var el = U.$('mRob'), i, k;
    if (!colocar(el, p)) { return; }
    var g = grupoDados('ferramentas') || {}, l = ordemRobos(robosDados()), rb = g.rb || {}, ri = itensDosRobos();
    var max = Math.max(1, Math.floor((p.h - 58 - 22) / 22));
    var s = cabeca('ROB\u00d4S', ri.length ? pillDe(ri) : ['verde', 'OK']);
    var res = (rb.fal ? rb.fal + ' com problema \u00b7 ' : '') + (rb.ok || 0) + ' em dia' + (rb.rod ? ' \u00b7 ' + rb.rod + ' rodando' : '');
    if (rb.off && res.length <= 12) { res += ' \u00b7 ' + rb.off + ' ' + U.plural(rb.off, 'desligado', 'desligados'); }
    s += '<div class="mrres">' + U.esc('Power Automate \u00b7 ' + res) + '</div><div class="mrlista">';
    for (i = 0; i < l.length && i < max; i++) {
      var r = l[i], est = COR[r.estado] ? r.estado : 'info', h = (r.h || []).slice(0, 8);
      s += '<div class="mr1 ' + est + (i === 0 ? ' prim' : '') + '" data-act="mon-robo" data-arg="' + U.esc(r.id || '') + '"><i class="md ' + est + '" style="background:' + (r.sit === 'rodando' ? '#7fc4ff' : COR[est]) + '"></i>' +
        '<div class="mrn">' + U.esc(nomeRobo(r.nome, 19)) + '</div>';
      if (r.estado === 'off') { s += '<div class="mrt">desligado</div>'; }
      else {
        s += '<div class="mrq">';
        for (k = 0; k < h.length; k++) { s += '<i' + (h[k][0] === 'U' ? ' class="rod"' : '') + ' style="left:' + ((7 - k) * 9) + 'px;background:' + (COR_Q[h[k][0]] || '#4b6284') + '"></i>'; }
        s += '</div>';
      }
      s += '</div>';
    }
    s += '</div><div class="mmais">' + (l.length > max ? '+ ' + (l.length - max) + ' \u00b7 toque para ver todos' : 'toque num rob\u00f4 para abrir a ficha') + '</div>';
    U.html('mRob', s);
  }
  /* o que pede olho agora, de qualquer cart\u00e3o: modelos fora do ritmo, itens em problema ou alerta (os silenciados s\u00f3 na lista completa) */
  function listaAtencao(todos) {
    var l = [], mods = modelosDo('bi'), agora = agoraMs(), ids = ['bi', 'ferramentas'], i, g;
    for (i = 0; i < mods.length; i++) {
      if (mods[i].estado !== 'erro' && mods[i].estado !== 'alerta') { continue; }
      l.push({ est: mods[i].estado, nome: mods[i].nome || '', sub: statusModelo(mods[i], agora).txt || mods[i].txt || '', quando: mods[i].inc || '', modelo: mods[i], sil: false, act: 'mon-abrir-modelo', arg: mods[i].id });
    }
    for (g = 0; g < ids.length; g++) {
      var itens = itensDo(ids[g]);
      for (i = 0; i < itens.length; i++) {
        var it = itens[i];
        if (it.m || it.r || it.d || (it.estado !== 'erro' && it.estado !== 'alerta')) { continue; }
        var quieto = !!silenciado(it);
        if (quieto && !todos) { continue; }
        l.push({ est: it.estado, nome: it.nome || '', sub: it.valor || '', quando: it.quando || '', item: it, sil: quieto, act: it.rb ? 'mon-robo' : 'mon-abrir', arg: it.rb || it.chave || it.nome || '' });
      }
    }
    for (i = 0; i < l.length; i++) { l[i]._o = i; }
    l.sort(function (a, b) {
      var ta = quando(a.quando) || 0, tb = quando(b.quando) || 0;
      return ((a.sil ? 1 : 0) - (b.sil ? 1 : 0)) || ((PESO[b.est] || 0) - (PESO[a.est] || 0)) || (tb - ta) || (a._o - b._o);
    });
    return l;
  }
  function renderAtencao(p) {
    var el = U.$('mAt'), i;
    if (!colocar(el, p)) { return; }
    var l = listaAtencao(false), nSil = listaAtencao(true).length - l.length, agora = agoraMs(), nErro = 0, max = Math.max(1, Math.floor((p.h - 40 - 22) / 44));
    for (i = 0; i < l.length; i++) { if (l[i].est === 'erro') { nErro++; } }
    var pill = nErro ? ['vermelho', nErro + ' ' + U.plural(nErro, 'PROBLEMA', 'PROBLEMAS')] : (l.length ? ['ambar', l.length + ' ' + U.plural(l.length, 'ALERTA', 'ALERTAS')] : ['verde', 'TUDO CERTO']);
    var s = cabeca('ATEN\u00c7\u00c3O', pill);
    if (!l.length) {
      var g = grupoDados('bi') || {}, r = g.resumo || {}, rb = (grupoDados('ferramentas') || {}).rb || {}, nPil = pilares().length, partes2 = [];
      if (r.total) { partes2.push(r.total + ' ' + U.plural(r.total, 'modelo', 'modelos')); }
      if (rb.lig) { partes2.push(rb.lig + ' ' + U.plural(rb.lig, 'rob\u00f4', 'rob\u00f4s')); }
      if (nPil) { partes2.push(nPil + ' ' + U.plural(nPil, 'servi\u00e7o', 'servi\u00e7os')); }
      s += '<div class="matok"><b>\u2713</b><span>Nada pedindo aten\u00e7\u00e3o</span><em>' + U.esc(m.dados ? (partes2.length ? 'Acompanhando ' + partes2.join(', ') + '.' : '') : 'Sem dados ainda.') + '</em></div>';
    } else {
      s += '<div class="mlista">';
      for (i = 0; i < l.length && i < max; i++) {
        var a = l[i], t = quando(a.quando);
        s += '<div class="mat ' + a.est + (i === 0 ? ' prim' : '') + '" data-act="' + a.act + '" data-arg="' + U.esc(a.arg || '') + '"><i class="md ' + a.est + '" style="background:' + COR[a.est] + '"></i>' +
          '<div class="matn">' + U.esc(a.nome) + '</div><div class="mats">' + U.esc(a.sub + (t !== null && agora - t >= 60000 && !/h\u00e1 |\d\d:\d\d/.test(a.sub) ? ' \u00b7 ' + idadeTxt(agora - t) : '')) + '</div></div>';
      }
      s += '</div>';
    }
    var pe = l.length > max ? '+ ' + (l.length - max) + ' \u00b7 toque para ver todos' : (l.length ? 'toque num item para abrir' : '');
    if (nSil) { pe = (pe ? pe + ' \u00b7 ' : '') + nSil + ' ' + U.plural(nSil, 'silenciado', 'silenciados'); }
    s += '<div class="mmais">' + pe + '</div>';
    U.html('mAt', s);
  }

  function renderGrupos() {
    var vis = gruposVisiveis(), pos = posicoes(vis);
    seguro('servi\u00e7os', function () { renderServicos(pos.srv || null); });
    seguro('rob\u00f4s', function () { renderRobos(pos.rob || null); });
    seguro('aten\u00e7\u00e3o', function () { renderAtencao(pos.at || null); });
    for (var i = 0; i < GRUPOS.length; i++) {
      var g = GRUPOS[i], el = U.$('mG-' + g.id), p = pos[g.id];
      if (!el) { continue; }
      U.classe(el, 'est', false);
      if (!p) { el.style.display = 'none'; continue; }
      el.style.display = 'block';
      el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; el.style.width = p.w + 'px'; el.style.height = p.h + 'px';
      if (g.id === 'bi' && p.h >= 500 && modelosDo('bi').length) { renderSaude(g, p); }
      else { renderGrupo(g, p, p.h > 270 && p.h < 400); }
    }
    renderEventos(pos.ev || null);
  }

  /* ---------- lista completa (toque num cart\u00e3o) ---------- */
  function listaDetalhe(id) {
    var agora = agoraMs(), l = [], i, itens;
    if (id === 'eventos') {
      var evs = eventosDoPC();
      for (i = 0; i < evs.length; i++) { l.push({ nome: evs[i].x, valor: quando(evs[i].t) !== null ? quandoTxt(quando(evs[i].t)) : '', detalhe: evs[i].d, estado: COR[evs[i].n] ? evs[i].n : 'info', quando: evs[i].t }); }
      return l;
    }
    if (id === 'robos') {
      var rbs = ordemRobos(robosDados());
      for (i = 0; i < rbs.length; i++) { l.push({ nome: rbs[i].nome, valor: rbs[i].txt || '', detalhe: rbs[i].det || '', estado: rbs[i].estado, quando: rbs[i].quando, rb: rbs[i].id }); }
      return l;
    }
    if (id === 'atencao') {
      var at = listaAtencao(true);
      for (i = 0; i < at.length; i++) { l.push(at[i].modelo ? { nome: at[i].nome, valor: at[i].sub, detalhe: at[i].modelo.det || '', estado: at[i].est, quando: at[i].quando, modelo: at[i].modelo } : at[i].item); }
      return l;
    }
    var mods = id === 'bi' ? ordenarModelos(modelosDo('bi')) : [];
    for (i = 0; i < mods.length; i++) {
      var mo = mods[i], st = statusModelo(mo, agora), det;
      if (mo.estado === 'erro' || mo.estado === 'alerta' || mo.estado === 'off') { det = mo.det || ''; }
      else { det = (mo.rit || '') + (mo.medS ? ' \u00b7 leva uns ' + durLonga(mo.medS) : '') + (mo.n ? ' \u00b7 ' + mo.ok + ' de ' + mo.n + ' deram certo' : '') + (mo.lim ? ' \u00b7 no limite do ritmo' : '') + (mo.ct && (mo.ct.di || mo.ct.cal) ? ' \u00b7 data imposs\u00edvel nos dados' : ''); }
      l.push({ nome: mo.nome, valor: st.txt, detalhe: det, estado: mo.estado, quando: mo.fim, modelo: mo });
    }
    itens = ordenar(itensDo(id));
    for (i = 0; i < itens.length; i++) {
      var it = itens[i];
      if (mods.length && (it.m || it.r)) { continue; } // com a lista de modelos, os resumos e os itens de modelo n\u00e3o se repetem
      l.push(it);
      // vers\u00f5es antigas do coletor mandavam os parados dentro de um resumo
      if (!mods.length && it.parados && it.parados.length) {
        for (var j = 0; j < it.parados.length; j++) {
          var pa = it.parados[j];
          l.push({ nome: pa.nome, estado: 'off', valor: 'parado', detalhe: (pa.area || '') + ' \u00b7 ' + (pa.motivo || ''), quando: pa.desde });
        }
      }
    }
    return l;
  }
  function tituloDetalhe(id) {
    if (id === 'eventos') { return 'ACONTECIMENTOS'; }
    if (id === 'robos') { return 'ROB\u00d4S DO POWER AUTOMATE'; }
    if (id === 'atencao') { return 'ATEN\u00c7\u00c3O'; }
    for (var i = 0; i < GRUPOS.length; i++) { if (GRUPOS[i].id === id) { return GRUPOS[i].nome; } }
    return '';
  }
  function renderDetalhe() {
    if (!m.det) { return; }
    var i, itens = listaDetalhe(m.det), total = itens.length, paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
    m.lista = itens;
    if (m.pag > paginas - 1) { m.pag = paginas - 1; }
    if (m.pag < 0) { m.pag = 0; }
    var temFicha = false;
    for (i = 0; i < total; i++) { if (itens[i].modelo) { temFicha = true; } }
    U.txt('mDetTit', tituloDetalhe(m.det) + ' \u00b7 ' + total + ' ' + U.plural(total, 'item', 'itens') + (m.det === 'eventos' ? '' : (m.det === 'robos' ? ' \u00b7 toque num rob\u00f4 para ver mais' : (temFicha ? ' \u00b7 toque num modelo ou item para ver mais' : ' \u00b7 toque num item para ver mais'))));
    var agora = agoraMs(), s = '';
    for (i = m.pag * POR_PAGINA; i < total && i < (m.pag + 1) * POR_PAGINA; i++) {
      var act = itens[i].modelo ? ' data-act="mon-modelo" data-arg="' + i + '"' : (m.det !== 'eventos' ? ' data-act="mon-item" data-arg="' + i + '"' : '');
      s += linhaItem(itens[i], i === m.pag * POR_PAGINA, agora, act);
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
  function fecharFicha() { m.ficha = -1; m.fichaTipo = ''; m.fichaVolta = ''; m.fichaId = ''; m.fichaItem = null; U.classe(U.$('mFicha'), 'esc', true); U.classe(U.$('mFichaAlt'), 'esc', true); }
  /* Voltar: a ficha de um modelo aberta pelo mapa volta para o mapa */
  function voltarFicha() {
    if (m.fichaVolta === 'mapa' && m.fichaTipo !== 'mapa') { m.fichaVolta = ''; m.fichaTipo = 'mapa'; m.ficha = 0; renderFicha(); return; }
    fecharFicha();
  }
  function fecharDetalhe() { m.det = null; U.classe(U.$('mDet'), 'esc', true); fecharFicha(); }

  /* ---------- ficha do modelo ---------- */
  var NOME_SIT = {
    ok: ['verde', 'NO RITMO'], rodando: ['ciano', 'ATUALIZANDO'], lento: ['ambar', 'LENTO'], travado: ['vermelho', 'TRAVADO'],
    falhou: ['vermelho', 'FALHOU'], tentando: ['ambar', 'TENTANDO DE NOVO'], atrasado: ['ambar', 'ATRASADO'], desligada: ['vermelho', 'AGENDA DESLIGADA'],
    cancelada: ['ambar', 'CANCELADA'], velho: ['ambar', 'SEM ATUALIZAR'], parado: ['cinza', 'PARADO'], nunca: ['cinza', 'NUNCA ATUALIZOU'], semleitura: ['ambar', 'SEM LEITURA']
  };
  var DICAS_LIMITE = [
    'Atualiza\u00e7\u00e3o incremental: recarregar s\u00f3 os meses recentes, em vez da tabela inteira a cada vez.',
    'Tirar do modelo as colunas e tabelas que o relat\u00f3rio n\u00e3o usa.',
    'Se dado de 1 hora servir, passar a agenda para de hora em hora: metade da carga no gateway e nenhum hor\u00e1rio pulado.'
  ];
  function cadTxt(min) {
    if (!(min > 0)) { return ''; }
    if (min < 90) { return Math.round(min) + ' min'; }
    var hh = Math.floor(min / 60), mm = Math.round(min % 60);
    return hh + 'h' + (mm ? U.pad2(mm) : '');
  }
  /* quanto do intervalo a atualiza\u00e7\u00e3o ocupa, hor\u00e1rios pulados e a idade real do dado (vem do coletor 1.5) */
  function apertoTxt(mo) {
    if (!mo.p90S || !mo.medS || !mo.cad || mo.cad > 180) { return ''; }
    var t = 'Leva em geral ' + durLonga(mo.medS) + ' de cada ' + cadTxt(mo.cad) + '; 1 em cada 10 passa de ' + durLonga(mo.p90S) + '.';
    if (mo.pul) {
      if (mo.pul[0]) { t += ' Pulou ' + mo.pul[0] + ' dos \u00faltimos ' + mo.pul[1] + ' hor\u00e1rios' + (mo.pul[2] ? ' (' + mo.pul[2] + ' com a anterior ainda rodando)' : '') + '.'; }
      else { t += ' Nenhum hor\u00e1rio pulado nos \u00faltimos ' + mo.pul[1] + '.'; }
    }
    if (mo.idM) { t += ' Na pr\u00e1tica, quem abre o painel v\u00ea dado de uns ' + mo.idM + ' min' + (mo.idP ? ' (9 em cada 10 vezes, at\u00e9 ' + mo.idP + ' min)' : '') + '.'; }
    return t;
  }
  function milTxt(n) {
    n = Number(n) || 0;
    if (n >= 999500) { return String(Math.round(n / 100000) / 10).replace('.', ',') + ' mi de'; }
    if (n >= 10000) { return Math.round(n / 1000) + ' mil'; }
    return String(Math.round(n));
  }
  /* data local guardada pelo modelo ('2026-11-27T22:38'): hoje, ontem ou dd/mm (com a hora, se tiver) */
  function diaRel(v) {
    var m2 = /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d))?/.exec(String(v || ''));
    if (!m2) { return ''; }
    var hoje = local(agoraMs()), d = new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]));
    var dias = Math.round((meiaNoite(hoje) - d.getTime()) / 86400000), h = m2[4] && (m2[4] !== '00' || m2[5] !== '00') ? ' ' + m2[4] + ':' + m2[5] : '';
    if (h && d.getTime() + (Number(m2[4]) * 60 + Number(m2[5])) * 60000 > hoje.getTime()) { h = ''; } // hora ainda por vir (fim do dia): s\u00f3 o dia
    if (dias === 0) { return 'hoje' + h; }
    if (dias === 1) { return 'ontem' + h; }
    return m2[3] + '/' + m2[2] + (dias > 300 ? '/' + m2[1] : '') + h;
  }
  function paradasTxt(c) {
    var l = [], i;
    for (i = 0; i < c.par.length && i < 3; i++) { l.push(c.par[i][0] + ' (desde ' + c.par[i][1] + ')'); }
    return 'paradas no tempo: ' + l.join(', ') + (c.par.length > 3 ? '\u2026' : '');
  }
  /* conte\u00fado do modelo (coletor 1.6 e 1.7): origem parada, tabela que parou, veio vazia ou encolheu, data imposs\u00edvel,
     calend\u00e1rio gigante e, sem achado, o dado mais recente que chegou */
  function conteudoTxt(mo) {
    var c = mo.ct, p = [], i, t;
    if (!c) { return null; }
    if (c.op && c.ul) { p.push('a origem parou: a atualiza\u00e7\u00e3o d\u00e1 certo, mas o dado mais recente (' + c.ul[0] + ') ainda \u00e9 de ' + diaRel(c.ul[2])); }
    if (c.pr) { for (i = 0; i < c.pr.length && i < 2; i++) { p.push('a tabela ' + c.pr[i][0] + ' parou de receber dado em ' + c.pr[i][1]); } }
    if (c.vz) { for (i = 0; i < c.vz.length; i++) { p.push('a tabela ' + c.vz[i][0] + ' veio vazia (tinha ' + milTxt(c.vz[i][1]) + ' linhas)'); } }
    if (c.enc) { for (i = 0; i < c.enc.length; i++) { p.push('a tabela ' + c.enc[i][0] + ' encolheu de ' + milTxt(c.enc[i][1]) + ' para ' + milTxt(c.enc[i][2]) + ' linhas'); } }
    if (c.di) {
      for (i = 0; i < c.di.length && i < 2; i++) { p.push('data imposs\u00edvel em ' + c.di[i][0] + ' \u00b7 ' + c.di[i][1] + ': ' + c.di[i][2]); }
      if (c.diN > 2) { p.push('e mais ' + (c.diN - 2)); }
    }
    if (c.cal) { for (i = 0; i < c.cal.length; i++) { p.push('o calend\u00e1rio ' + c.cal[i][0] + ' tem ' + milTxt(c.cal[i][1]) + ' linhas'); } }
    if (p.length) {
      if (c.par && c.par.length) { p.push(paradasTxt(c)); }
      t = p.join('; '); return { ruim: true, txt: t.charAt(0).toUpperCase() + t.slice(1) + '.' };
    }
    var lido = quando(c.t), mud = quando(c.mud), esq = '';
    if (c.esq && quando(c.esq[0]) !== null) { esq = 'A estrutura mudou ' + quandoTxt(quando(c.esq[0])) + ' (' + c.esq[2][0] + (c.esq[1] > 1 ? ' e mais ' + (c.esq[1] - 1) : '') + '). '; }
    if (esq) { return { ruim: false, par: true, txt: esq + (c.ul ? 'Dado mais recente: ' + diaRel(c.ul[2]) + ' (' + c.ul[0] + ') \u00b7 ' : '') + c.nt + ' tabelas e ' + milTxt(c.nl) + ' linhas' + (lido !== null ? ' \u00b7 conferido ' + quandoTxt(lido) : '') }; }
    if (c.par && c.par.length) {
      t = (c.ul ? 'Dado mais recente: ' + diaRel(c.ul[2]) + ' (' + c.ul[0] + '). ' : '') + paradasTxt(c).charAt(0).toUpperCase() + paradasTxt(c).slice(1) + ' \u2014 sem dado novo h\u00e1 mais de 30 dias.';
      return { ruim: false, par: true, txt: t };
    }
    return { ruim: false, txt: (c.ul ? 'Dado mais recente: ' + diaRel(c.ul[2]) + ' (' + c.ul[0] + ') \u00b7 ' : '') + c.nt + ' tabelas e ' + milTxt(c.nl) + ' linhas' + (lido !== null ? ' \u00b7 conferido ' + quandoTxt(lido) : '') + ' \u00b7 nenhuma tabela vazia, nenhuma data imposs\u00edvel' + (mud !== null ? ' \u00b7 mudou pela \u00faltima vez ' + quandoTxt(mud) : '') };
  }
  /* o que fazer quando o modelo est\u00e1 no limite do ritmo: primeiro o que o Monitor achou nele, depois o geral */
  function dicasLimite(mo) {
    var l = [], c = mo.ct || {}, grandes = [], i;
    if (mo.td && mo.td[1]) { l.push('A dura\u00e7\u00e3o cresce uns ' + mo.td[0] + '% por semana: no ritmo atual, passa do intervalo em ~' + mo.td[1] + ' dias.'); }
    if (c.par) { for (i = 0; i < c.par.length; i++) { if (c.par[i][3] >= 50000) { grandes.push(c.par[i][0]); } } }
    if (grandes.length) { l.push('No Power Query, desmarcar "Incluir na atualiza\u00e7\u00e3o do relat\u00f3rio" nas tabelas paradas no tempo (' + grandes.slice(0, 2).join(', ') + (grandes.length > 2 ? '\u2026' : '') + '), para n\u00e3o recarregarem sem mudar a cada atualiza\u00e7\u00e3o.'); }
    if (mo.tq >= 60) { l.push('Ver se o cache de consultas precisa ficar ligado (configura\u00e7\u00f5es do modelo): ele soma ' + durLonga(mo.tq) + ' a cada atualiza\u00e7\u00e3o.'); }
    for (i = 0; i < DICAS_LIMITE.length && l.length < 3; i++) { l.push(DICAS_LIMITE[i]); }
    return l;
  }
  /* outros modelos que falharam at\u00e9 10 min antes ou depois (a causa pode ser comum) */
  function falharamJuntos(mo, t) {
    var mods = modelosDo('bi'), l = [], i, j;
    for (i = 0; i < mods.length; i++) {
      if (mods[i].id === mo.id) { continue; }
      var h = mods[i].h || [];
      for (j = 0; j < h.length; j++) { if (h[j][0] === 'F' && Math.abs(h[j][1] * 1000 - t) <= 600000) { l.push(mods[i].nome); break; } }
    }
    return l;
  }
  function bloco(x, rotulo, valor, sub) {
    return '<div class="mfb" style="left:' + x + 'px"><div class="mfl">' + rotulo + '</div><div class="mfv">' + U.esc(valor) + '</div><div class="mfs">' + U.esc(sub || '') + '</div></div>';
  }
  function renderFicha() {
    if (m.ficha < 0) { return; }
    var alt = U.$('mFichaAlt');
    if (alt) { U.classe(alt, 'esc', m.fichaTipo !== 'mapa'); U.txt('mFichaAlt', m.mapa7 ? '24 horas' : '7 dias'); }
    if (m.fichaTipo === 'mapa') { if (m.mapa7) { renderMapa7(); } else { renderMapa(); } return; }
    if (m.fichaTipo === 'robo') { renderRobo(); return; }
    if (m.fichaTipo === 'item') { renderItem(); return; }
    renderFichaModelo();
  }
  function renderFichaModelo() {
    var linha = m.lista[m.ficha], mo = m.fichaId ? null : (linha && linha.modelo), agora = agoraMs(), i;
    // o modelo pode ter mudado desde que a lista foi montada: pega a vers\u00e3o nova pelo id
    var mods = modelosDo('bi'), id = m.fichaId || (mo && mo.id);
    for (i = 0; i < mods.length; i++) { if (mods[i].id === id) { mo = mods[i]; } }
    if (!mo) { fecharFicha(); return; }
    var sit = NOME_SIT[mo.sit] || ['cinza', String(mo.sit || '').toUpperCase()];
    if (mo.sit === 'atrasado' && mo.estado === 'erro') { sit = ['vermelho', 'PAROU']; }
    if (mo.sit === 'falhou' && mo.estado === 'alerta') { sit = ['ambar', 'FALHOU']; }
    var fim = quando(mo.fim), prox = quando(mo.prox), ini = quando(mo.ini), prev = quando(mo.prev);
    var s = '<div class="ptit">' + U.esc(mo.nome || '') + '</div><div class="mfp"><span class="pill ' + sit[0] + '">' + sit[1] + '</span></div>';
    var pbT = mo.pb ? quando(mo.pb[0]) : null;
    s += '<div class="mfsub">' + U.esc((mo.pasta || '') + (mo.fts ? ' \u00b7 usa ' + mo.fts : '') + (mo.rb ? ' \u00b7 disparado pelo rob\u00f4 ' + mo.rb[0] : '') +
      (pbT !== null ? ' \u00b7 publicado ' + quandoTxt(pbT) : '') + (mo.nf ? ' \u00b7 sem e-mail de falha' : '')) + '</div>';
    // quatro n\u00fameros
    var ultSub = mo.durS ? 'levou ' + durLonga(mo.durS) : '';
    if (mo.rod && ini !== null) { ultSub = 'atualizando de novo desde ' + hora(ini) + (prev !== null && prev > agora ? ', termina por volta de ' + hora(prev) : ''); }
    s += bloco(18, '\u00daLTIMA QUE DEU CERTO', fim !== null ? quandoTxt(fim) : '\u2014', ultSub);
    s += bloco(266, 'RITMO', mo.rit || '\u2014', prox !== null && prox > agora ? 'pr\u00f3xima por volta de ' + hora(prox) : '');
    var difTxt = '';
    if (mo.medS && mo.durS) {
      var dif = Math.round((mo.durS - mo.medS) / mo.medS * 100);
      difTxt = 'a \u00faltima levou ' + durLonga(mo.durS) + (Math.abs(dif) >= 10 ? ' (' + (dif > 0 ? '+' : '') + dif + '%)' : '');
    }
    s += bloco(514, 'DURA\u00c7\u00c3O NORMAL', mo.medS ? durLonga(mo.medS) : '\u2014', difTxt);
    var conf = mo.n ? mo.ok + ' de ' + mo.n : '\u2014', confSub = '';
    if (mo.h24 && (mo.h24[0] || mo.h24[1])) { confSub = '24h: ' + mo.h24[0] + ' certas \u00b7 ' + mo.h24[1] + ' ' + U.plural(mo.h24[1], 'falha', 'falhas'); }
    s += bloco(762, 'DERAM CERTO', conf, confSub);
    // hist\u00f3rico
    var h = mo.h || [];
    var limS = intervaloS(mo), maxH = limS, hi;
    for (hi = 0; hi < h.length && hi < 20; hi++) { if (h[hi][2] > maxH) { maxH = h[hi][2]; } }
    s += '<div class="mfl" style="left:18px;top:178px">\u00daLTIMAS ' + h.length + ' ATUALIZA\u00c7\u00d5ES \u00b7 a altura \u00e9 o tempo que levou \u00b7 vermelho = falhou' + (limS ? ' \u00b7 amarelo = quase o intervalo todo' : '') + '</div>';
    s += '<div class="mfbar">' + barras(h, 20, 40, 7, 84, limS, limS);
    if (limS) {
      var yLim = Math.round(84 * limS / maxH);
      s += '<b class="mflim" style="bottom:' + yLim + 'px"></b><span class="mflimt" style="bottom:' + (yLim + 3) + 'px">' + cadTxt(mo.cad) + ' \u00b7 o intervalo</span>';
    }
    s += '</div>';
    if (h.length) {
      s += '<div class="mfcap" style="left:18px">' + quandoTxt(h[h.length - 1][1] * 1000) + '</div><div class="mfcap" style="right:18px;text-align:right">' + quandoTxt(h[0][1] * 1000) + '</div>';
    }
    // 24 horas
    var faixa = mo.faixa || '';
    if (faixa.length === 24) {
      s += '<div class="mfl" style="left:18px;top:318px">\u00daLTIMAS 24 HORAS, HORA A HORA \u00b7 verde = tudo certo \u00b7 vermelho = teve falha \u00b7 escuro = sem atualiza\u00e7\u00e3o</div><div class="mffx">';
      for (i = 0; i < 24; i++) {
        var ch = faixa.charAt(i);
        s += '<i style="left:' + (i * 39) + 'px;background:' + (ch === 'o' ? '#2f9e68' : (ch === 'm' ? '#f59e0b' : (ch === 'x' ? '#ff7a7a' : '#0e2238'))) + '"></i>';
      }
      s += '</div>';
    }
    // o que aconteceu e o que fazer
    var y = 386;
    if (mo.estado === 'erro' || mo.estado === 'alerta') {
      s += '<div class="mfl" style="left:18px;top:' + y + 'px">O QUE ACONTECEU</div><div class="mft" style="top:' + (y + 16) + 'px">' +
        U.esc((mo.pbf && pbT !== null ? 'Come\u00e7ou a falhar logo depois da publica\u00e7\u00e3o de ' + quandoTxt(pbT) + ': comece por o que mudou no arquivo \u00b7 ' : '') + (mo.txt ? mo.txt + ' \u00b7 ' : '') + (mo.det || '')) + '</div>';
      y += 66;
      if (mo.dica && mo.dica.length) {
        s += '<div class="mfl" style="left:18px;top:' + y + 'px">O QUE FAZER</div><div class="mfd" style="top:' + (y + 16) + 'px">';
        for (i = 0; i < mo.dica.length && i < 3; i++) { s += '<div><b>' + (i + 1) + '.</b> ' + U.esc(mo.dica[i]) + '</div>'; }
        s += '</div>';
      }
    } else {
      // folga no ritmo: o modelo pode n\u00e3o falhar nunca e mesmo assim entregar dado velho
      var ap = apertoTxt(mo);
      if (ap) {
        s += '<div class="mfl' + (mo.lim ? ' ambar' : '') + '" style="left:18px;top:' + y + 'px">' + (mo.lim ? 'NO LIMITE DO RITMO' : 'FOLGA NO RITMO') + '</div><div class="mft menor' + (mo.lim ? '' : ' cinza') + '" style="top:' + (y + 16) + 'px">' + U.esc(ap) + '</div>';
        y += 62;
        if (mo.lim) {
          var dl = dicasLimite(mo);
          s += '<div class="mfl" style="left:18px;top:' + y + 'px">O QUE FAZER</div><div class="mfd" style="top:' + (y + 16) + 'px">';
          for (i = 0; i < dl.length; i++) { s += '<div class="mfd1"><b>' + (i + 1) + '.</b> ' + U.esc(dl[i]) + '</div>'; }
          s += '</div>';
          y += 16 + 21 * dl.length + 8;
        }
      }
      // conte\u00fado do modelo: quando s\u00f3 cabe um bloco, o achado no conte\u00fado vale mais que a \u00faltima falha
      var ct = conteudoTxt(mo), umSo = 572 - y < 100;
      var mostraCt = ct && (ct.ruim || !umSo), mostraFalha = !(umSo && mostraCt);
      if (mostraCt) {
        var duas = (ct.ruim || ct.par) && !umSo;
        s += '<div class="mfl' + (ct.ruim ? ' ambar' : '') + '" style="left:18px;top:' + y + 'px">' + (ct.ruim ? 'CONTE\u00daDO DO MODELO \u00b7 VALE CONFERIR' : 'CONTE\u00daDO DO MODELO') + '</div><div class="mft menor' + (duas ? '' : ' uma') + (ct.ruim ? '' : ' cinza') + '" style="top:' + (y + 16) + 'px' + (y > 470 ? ';width:810px' : '') + '">' + U.esc(ct.txt) + '</div>';
        y += duas ? 66 : 45;
      }
      var estreito = '', uma = '';
      if (y > 470) { estreito = ';width:810px'; uma = ' uma'; } // l\u00e1 embaixo sobra uma linha s\u00f3, e ela n\u00e3o pode passar por baixo do bot\u00e3o Voltar
      // tentativas escondidas (1.7): o Power BI repete sozinho a carga que falhou, e a atualiza\u00e7\u00e3o demora o dobro
      var rtQ = mo.rt ? quando(mo.rt[2]) : null;
      var rtTxt = mo.rt ? mo.rt[0] + ' das \u00faltimas ' + mo.rt[1] + ' s\u00f3 deu certo na ' + (mo.rt[4] || 2) + '\u00aa tentativa' + (rtQ !== null ? ' (' + quandoTxt(rtQ) + (mo.rt[3] ? ': ' + mo.rt[3] : '') + ')' : '') + '.' : '';
      if (!mostraFalha) { /* o bloco de conte\u00fado ocupou o lugar */ } else
      if (mo.uf) {
        var tf = quando(mo.uf.t), juntos = tf !== null ? falharamJuntos(mo, tf) : [];
        s += '<div class="mfl" style="left:18px;top:' + y + 'px">\u00daLTIMA FALHA REGISTRADA</div><div class="mft' + (ap ? ' menor' : '') + uma + '" style="top:' + (y + 16) + 'px' + estreito + '">' + (tf !== null ? quandoTxt(tf) + ' \u00b7 ' : '') + U.esc(mo.uf.frase || '') +
          (juntos.length ? U.esc(' \u00b7 no mesmo hor\u00e1rio tamb\u00e9m falh' + (juntos.length > 1 ? 'aram: ' : 'ou: ') + juntos.slice(0, 2).join(', ')) : '') + (rtTxt ? U.esc(' \u00b7 ' + rtTxt) : '') + '</div>';
      } else {
        s += '<div class="mfl" style="left:18px;top:' + y + 'px">SEM FALHA NO HIST\u00d3RICO</div><div class="mft cinza' + (ap ? ' menor' : '') + uma + '" style="top:' + (y + 16) + 'px' + estreito + '">' + U.esc(rtTxt ? 'Nenhuma falhou de vez, mas ' + rtTxt : 'Nenhuma das \u00faltimas ' + (mo.n || 0) + ' atualiza\u00e7\u00f5es falhou.') + '</div>';
      }
    }
    U.html('mFichaCorpo', s);
  }
  function abrirFicha(i) {
    var n = parseInt(i, 10), l = m.lista[n];
    if (isNaN(n) || !l || !l.modelo) { return; }
    m.ficha = n; m.fichaTipo = 'modelo'; m.fichaId = l.modelo.id; m.fichaVolta = ''; m.fichaItem = null;
    U.classe(U.$('mFicha'), 'esc', false);
    renderFicha();
  }
  function abrirModeloId(id) {
    var mods = modelosDo('bi'), i, achou = false;
    for (i = 0; i < mods.length; i++) { if (mods[i].id === id) { achou = true; } }
    if (!achou) { return; }
    m.ficha = 0; m.fichaTipo = 'modelo'; m.fichaId = id; m.fichaVolta = 'mapa'; m.fichaItem = null;
    U.classe(U.$('mFicha'), 'esc', false);
    renderFicha();
  }
  function abrirItem(i) {
    var n = parseInt(i, 10), l = m.lista[n];
    if (isNaN(n) || !l) { return; }
    if (l.modelo) { abrirFicha(n); return; }
    if (l.rb) { abrirRobo(l.rb); return; }
    m.ficha = n; m.fichaTipo = 'item'; m.fichaItem = l; m.fichaId = ''; m.fichaVolta = '';
    U.classe(U.$('mFicha'), 'esc', false);
    renderFicha();
  }
  /* 1.8: direto do painel (cart\u00f5es de servi\u00e7os, aten\u00e7\u00e3o e rob\u00f4s), sem passar pela lista */
  function abrirItemChave(chave) {
    var g, i, l;
    for (g = 0; g < GRUPOS.length; g++) {
      l = itensDo(GRUPOS[g].id);
      for (i = 0; i < l.length; i++) {
        if ((l[i].chave || l[i].nome) !== chave) { continue; }
        if (l[i].rb) { abrirRobo(l[i].rb); return; }
        m.ficha = 0; m.fichaTipo = 'item'; m.fichaItem = l[i]; m.fichaId = ''; m.fichaVolta = '';
        U.classe(U.$('mFicha'), 'esc', false);
        renderFicha();
        return;
      }
    }
  }
  function abrirModeloDireto(id) {
    var mods = modelosDo('bi'), i;
    for (i = 0; i < mods.length; i++) {
      if (mods[i].id !== id) { continue; }
      m.ficha = 0; m.fichaTipo = 'modelo'; m.fichaId = id; m.fichaVolta = ''; m.fichaItem = null;
      U.classe(U.$('mFicha'), 'esc', false);
      renderFicha();
      return;
    }
  }
  function abrirRobo(id) {
    var r = roboDe(id), itens = itensDo('ferramentas'), i;
    if (!r) { return; }
    m.ficha = 0; m.fichaTipo = 'robo'; m.fichaId = id; m.fichaVolta = ''; m.fichaItem = null;
    for (i = 0; i < itens.length; i++) { if (itens[i].rb === id) { m.fichaItem = itens[i]; } }
    U.classe(U.$('mFicha'), 'esc', false);
    renderFicha();
  }
  function abrirMapa() {
    if (!modelosDo('bi').length) { return; }
    m.mapa7 = false;
    m.ficha = 0; m.fichaTipo = 'mapa'; m.fichaId = ''; m.fichaVolta = ''; m.fichaItem = null;
    U.classe(U.$('mFicha'), 'esc', false);
    renderFicha();
  }

  /* ---------- ficha de um item (1.7): o que o Monitor viu, a carga do gateway e silenciar ---------- */
  var NOME_EST = { ok: ['verde', 'OK'], alerta: ['ambar', 'ALERTA'], erro: ['vermelho', 'PROBLEMA'], info: ['ciano', 'AVISO'], off: ['cinza', 'PARADO'] };
  /* o que fazer, pelo tipo do item (chave que o coletor publica); s\u00f3 aparece quando o item n\u00e3o est\u00e1 verde */
  var DICA_ITEM = [
    [/^vm\|api/, 'No console do Google Cloud (Compute Engine \u203a Inst\u00e2ncias de VM), veja se a VM est\u00e1 ligada. Se estiver, abra o SSH e rode: sudo systemctl restart caddy bot-api bot-whatsapp.'],
    [/^vm\|https/, 'Na VM (SSH): sudo systemctl restart caddy, para ele tentar renovar o certificado na hora. O dom\u00ednio do DuckDNS precisa apontar para o IP da VM.'],
    [/^vm\|relogio/, 'Na VM (SSH): sudo timedatectl set-ntp true, para o rel\u00f3gio voltar a acertar sozinho.'],
    [/^a1\|/, 'Renovar o certificado A1 com a certificadora e instalar o .pfx novo no servidor (o deploy autom\u00e1tico usa o segredo CERTIFICADO_PFX_BASE64 do GitHub).'],
    [/^vm\|whatsapp/, 'Na VM (SSH): sudo systemctl restart bot-whatsapp. Se o WhatsApp pedir para conectar de novo, o c\u00f3digo de pareamento aparece em: journalctl -u bot-whatsapp -n 30 | grep PAREAMENTO.'],
    [/^vm\|memoria/, 'Na VM (SSH): free -m e top mostram quem est\u00e1 usando a mem\u00f3ria; sudo systemctl restart bot-api bot-whatsapp libera na hora. Se acontecer sempre, vale uma m\u00e1quina com 2 GB (e2-small, que \u00e9 paga).'],
    [/^vm\|disco/, 'Na VM (SSH): du -sh ~/BOT_NATUREZAS/* | sort -h mostra o que cresce (cache de XML e registros); apague o que for antigo.'],
    [/^vm\|cpu/, 'Na VM (SSH): top mostra quem est\u00e1 usando a CPU. A e2-micro s\u00f3 aguenta pouco tempo de CPU alta antes de o Google frear.'],
    [/^vm\|rede/, 'No console do Google Cloud, Faturamento \u203a Relat\u00f3rios, filtre por Compute Engine e veja a linha de rede (Network Internet Egress). Se estiver cobrando, d\u00e1 para descobrir quem manda tanto dado.'],
    [/^rb\|pc/, 'Ligue o computador dos rob\u00f4s e deixe a sess\u00e3o do Windows aberta, sem ningu\u00e9m usando. Eles voltam no pr\u00f3ximo hor\u00e1rio; para adiantar, abra o fluxo no Power Automate e toque em Executar.'],
    [/^rb\|/, 'No Power Automate (make.powerautomate.com \u203a Meus fluxos), abra o fluxo: a execu\u00e7\u00e3o que falhou mostra em que passo parou. Para rodar agora, toque em Executar.'],
    [/^cl\|/, 'Nada a fazer: o problema \u00e9 na Anthropic. O bot volta a responder sozinho quando a API normalizar.'],
    [/^gc\|/, 'Nada a fazer do seu lado: \u00e9 um incidente do Google. Se a VM n\u00e3o voltar sozinha quando ele acabar, reinicie-a no console do Google Cloud.'],
    [/^sefaz\|/, 'Nada a fazer no BI: \u00e9 na SEFAZ. As lojas emitem em conting\u00eancia at\u00e9 normalizar; se durar, vale avisar o fiscal.'],
    [/^nf\|/, 'Nas configura\u00e7\u00f5es de cada modelo, em Atualiza\u00e7\u00e3o, marque "Enviar notifica\u00e7\u00f5es de falha de atualiza\u00e7\u00e3o" para o propriet\u00e1rio.'],
    [/^ac\|/, 'Para conferir quem tem acesso: no workspace, Gerenciar acesso.'],
    [/^gw\|/, 'No PC do gateway: veja se est\u00e1 ligado e com internet; no app do gateway, Configura\u00e7\u00f5es de servi\u00e7o \u203a Reiniciar agora.'],
    [/^gwver\|/, 'Baixar o instalador mais recente do gateway no site da Microsoft e instalar por cima, fora do hor\u00e1rio de pico: a configura\u00e7\u00e3o continua a mesma.'],
    [/^gwpes\|/, 'Para n\u00e3o depender de login, instalar o gateway no modo padr\u00e3o (servi\u00e7o do Windows) e passar as fontes para ele.'],
    [/^lic\|/, 'Centro de administra\u00e7\u00e3o do Microsoft 365 \u203a Cobran\u00e7a \u203a Seus produtos: renove se algu\u00e9m ainda usa; se ningu\u00e9m usa, pode deixar vencer.'],
    [/^cert\|venc/, 'Nada a fazer por enquanto: o GitHub renova sozinho, em geral bem antes do vencimento.'],
    [/^cert\|/, 'No Safari do iPad, abra letsencrypt.org/certificates, toque na raiz que aparece no fim da cadeia (arquivo .der) e instale o perfil.'],
    [/^gh\|/, 'Nada a fazer: o problema \u00e9 do GitHub. Os dados voltam a chegar sozinhos quando ele normalizar.'],
    [/^ms\|/, 'Nada a fazer: o problema \u00e9 na Microsoft. Se uma atualiza\u00e7\u00e3o falhar nesse per\u00edodo, rode de novo depois.'],
    [/^web\|/, 'Abra o site no navegador: se estiver fora do ar, espere voltar e atualize o modelo que usa essa fonte.'],
    [/^fonte\|/, 'Em Gerenciar conex\u00f5es e gateways (engrenagem do Power BI), abra a conex\u00e3o e teste: aparece a mensagem completa do erro.'],
    [/^lento\|/, 'Quando v\u00e1rios modelos ficam lentos juntos, a causa costuma ser comum: veja primeiro o PC do gateway (CPU e mem\u00f3ria) e o banco SQL.'],
    [/^Disco /, 'Configura\u00e7\u00f5es \u203a Sistema \u203a Armazenamento \u203a Arquivos tempor\u00e1rios; e esvaziar a Lixeira e a pasta Downloads.']
  ];
  function dicaItem(it) {
    if (!it || it.estado === 'ok' || it.estado === 'off') { return ''; }
    for (var i = 0; i < DICA_ITEM.length; i++) { if (DICA_ITEM[i][0].test(it.chave || '') || DICA_ITEM[i][0].test(it.nome || '')) { return DICA_ITEM[i][1]; } }
    return '';
  }
  function itemAtual(velho) {
    var k = velho.chave || velho.nome, g, i, l;
    for (g = 0; g < GRUPOS.length; g++) {
      l = itensDo(GRUPOS[g].id);
      for (i = 0; i < l.length; i++) { if ((l[i].chave || l[i].nome) === k) { return l[i]; } }
    }
    return velho;
  }
  /* o detalhe vem com as partes separadas por " \u00b7 ": na ficha, cada parte numa linha */
  function partes(txt) {
    var l = String(txt || '').split(' \u00b7 '), r = [], i;
    for (i = 0; i < l.length; i++) { if (l[i]) { r.push(/^[a-z0-9-]+\.[a-z]/.test(l[i]) ? l[i] : l[i].charAt(0).toUpperCase() + l[i].slice(1)); } } // endere\u00e7o fica como est\u00e1
    return r;
  }
  function horaDe(ms) { return U.pad2(local(ms).getHours()) + 'h'; }
  function sugestaoTxt(sg) {
    if (!sg) { return ''; }
    if (sg.ok) {
      return 'As ' + sg.n + ' agendas de meia em meia hora j\u00e1 est\u00e3o bem distribu\u00eddas (pico simulado de ' + sg.pico + ' ao mesmo tempo)' +
        (sg.turmaB && sg.turmaB.length ? ': ' + sg.turmaB.length + ' j\u00e1 rodam em :15 e :45, no fuso (UTC+05:45) Katmandu.' : '.');
    }
    var nep = [], bra = [], i;
    for (i = 0; i < (sg.mover || []).length; i++) { (sg.mover[i][1] === 'nepal' ? nep : bra).push(sg.mover[i][0]); }
    return (nep.length ? 'Passar ' + nep.join(', ') + ' para o fuso (UTC+05:45) Katmandu na atualiza\u00e7\u00e3o agendada: ' + U.plural(nep.length, 'ela passa', 'elas passam') + ' a rodar em :15 e :45' : '') +
      (bra.length ? (nep.length ? '; e ' : 'Passar ') + bra.join(', ') + ' de volta para o fuso de Bras\u00edlia' : '') +
      '. O pico simulado cai de ' + sg.pico + ' para ' + sg.novo + ' atualiza\u00e7\u00f5es ao mesmo tempo.';
  }
  /* carga do gateway: uma barra por hora (altura = pico da hora, parte clara = m\u00e9dia) */
  function graficoGateway(cg, y) {
    var hh = cg.hh, h0 = quando(cg.h0), de = quando(cg.de), max = 1, kMax = 0, k, s = '';
    for (k = 0; k < 24; k++) { if (hh[k][1] >= max) { max = hh[k][1]; kMax = k; } }
    s += '<div class="mgw" style="top:' + y + 'px">';
    for (k = 0; k < 24; k++) {
      var p = hh[k][1], md = hh[k][0], hp = p ? Math.max(3, Math.round(70 * p / max)) : 0, hm = md ? Math.max(2, Math.round(70 * md / max)) : 0;
      var parcial = de !== null && h0 !== null && h0 + (k + 1) * 3600000 <= de;
      s += '<i class="pk' + (parcial ? ' parc' : '') + '" style="left:' + (k * 39) + 'px;height:' + hp + 'px"></i>';
      if (hm) { s += '<i class="mdg' + (parcial ? ' parc' : '') + '" style="left:' + (k * 39) + 'px;height:' + Math.min(hm, hp) + 'px"></i>'; }
      if (k === kMax || k === 23) { s += '<span style="left:' + (k * 39) + 'px;bottom:' + (hp + 2) + 'px">' + p + '</span>'; }
    }
    s += '</div>';
    if (h0 !== null) {
      for (k = 0; k < 24; k++) {
        var hr = local(h0 + k * 3600000).getHours();
        if (k === 23) { s += '<div class="mhr" style="left:' + (18 + k * 39 - 3) + 'px;top:' + (y + 90) + 'px">agora</div>'; }
        else if (hr % 3 === 0 && k < 22) { s += '<div class="mhr" style="left:' + (18 + k * 39 - 3) + 'px;top:' + (y + 90) + 'px">' + U.pad2(hr) + 'h</div>'; }
      }
    }
    return { html: s, kMax: kMax, max: max, h0: h0, de: de };
  }
  function renderItem() {
    var it = itemAtual(m.fichaItem || {}), agora = agoraMs(), est = NOME_EST[it.estado] || NOME_EST.info, t = quando(it.quando), ate = silenciado(it), i;
    if (!m.fichaItem) { fecharFicha(); return; }
    if (it.vm && it.vm.fx) { renderVm(it); return; }
    var s = '<div class="ptit">' + U.esc(it.nome || '') + '</div><div class="mfp"><span class="pill ' + (ate ? 'cinza' : est[0]) + '">' + (ate ? 'SILENCIADO' : est[1]) + '</span></div>';
    var y = 82, cg = it.carga, ps = partes(it.detalhe), sub = (it.valor || '') + (t !== null ? ' \u00b7 desde ' + quandoTxt(t) + ' (' + idadeTxt(agora - t) + ')' : '');
    var ehGw = !!(cg && cg.hh && cg.hh.length === 24);
    if (ehGw) {
      // no gateway, a vers\u00e3o e o suporte v\u00e3o no subt\u00edtulo; a carga j\u00e1 est\u00e1 nos n\u00fameros
      for (i = 1; i < ps.length; i++) { if (/^(Vers\u00e3o|Com suporte)/.test(ps[i])) { sub += ' \u00b7 ' + ps[i].charAt(0).toLowerCase() + ps[i].slice(1); } }
      ps = [];
    }
    s += '<div class="mfsub">' + U.esc(sub) + '</div>';
    if (ehGw) {
      // gateway: quatro n\u00fameros, o gr\u00e1fico hora a hora e a sugest\u00e3o de hor\u00e1rios
      var gr = graficoGateway(cg, 198);
      s += bloco(18, 'AGORA', String(cg.agora || 0), U.plural(cg.agora || 0, 'atualiza\u00e7\u00e3o rodando', 'atualiza\u00e7\u00f5es rodando'));
      s += bloco(266, 'M\u00c9DIA', String(cg.media || 0).replace('.', ','), 'ao mesmo tempo, nas \u00faltimas ' + (cg.horas || 24) + ' h');
      s += bloco(514, 'PICO', String(cg.pico || gr.max), gr.h0 !== null ? 'na hora mais cheia: ' + horaDe(gr.h0 + gr.kMax * 3600000) : '');
      s += bloco(762, 'MODELOS', cg.n ? String(cg.n) : '\u2014', cg.n ? U.plural(cg.n, 'passa por ele', 'passam por ele') : '');
      s += '<div class="mfl" style="left:18px;top:178px">ATUALIZA\u00c7\u00d5ES AO MESMO TEMPO, HORA A HORA \u00b7 barra = pico da hora \u00b7 parte clara = m\u00e9dia</div>' + gr.html;
      y = 318;
      if (gr.de !== null) { s += '<div class="mfnota" style="top:' + (y - 4) + 'px">O registro come\u00e7ou ' + quandoTxt(gr.de) + ': antes disso a carga aparece menor do que foi (barras apagadas).</div>'; y += 20; }
      if (cg.sug) {
        s += '<div class="mfl' + (cg.sug.ok ? '' : ' ambar') + '" style="left:18px;top:' + (y + 4) + 'px">' + (cg.sug.ok ? 'HOR\u00c1RIOS DAS AGENDAS' : 'SUGEST\u00c3O PARA ALIVIAR O PICO') + '</div><div class="mft menor" style="top:' + (y + 20) + 'px">' + U.esc(sugestaoTxt(cg.sug)) + '</div>';
        y += 70;
        if (!cg.sug.ok) { s += '<div class="mfnota" style="top:' + (y - 6) + 'px">O Power BI s\u00f3 deixa agendar em :00 e :30; no fuso de Katmandu os mesmos hor\u00e1rios caem em :15 e :45 de Bras\u00edlia. Calculado com a dura\u00e7\u00e3o t\u00edpica de cada modelo; o Monitor n\u00e3o muda nada sozinho.</div>'; y += 40; }
      }
      if (it.pes) { s += '<div class="mfnota ambar" style="top:' + y + 'px">Modo pessoal: o gateway roda como programa do usu\u00e1rio, n\u00e3o como servi\u00e7o do Windows. Se o PC reiniciar, s\u00f3 volta quando algu\u00e9m entrar nele.</div>'; y += 24; }
    }
    // o que o Monitor viu e o que fazer, um embaixo do outro (o navegador arruma as alturas)
    var limite = podeSilenciar(it) ? 498 : 566, dica = dicaItem(it);
    if ((ps.length || dica) && y + 72 <= limite) {
      s += '<div class="mfx" style="top:' + (y + 6) + 'px;max-height:' + (limite - y - 6) + 'px">';
      if (ps.length) {
        s += '<div class="mfl2">O QUE O MONITOR VIU</div>';
        for (i = 0; i < ps.length; i++) { s += '<div class="mfx1"><b>\u203a</b> ' + U.esc(ps[i]) + '</div>'; }
      }
      if (dica) { s += '<div class="mfl2' + (ps.length ? ' esp' : '') + '">O QUE FAZER</div><div class="mfx1 dica">' + U.esc(dica) + '</div>'; }
      s += '</div>';
    }
    if (podeSilenciar(it)) {
      s += '<div class="mfl" style="left:18px;top:504px">' + (ate ? 'SILENCIADO AT\u00c9 ' + U.esc(quandoTxt(ate)).toUpperCase() : 'J\u00c1 SABE DISSO?') + '</div>';
      s += '<div class="mfnota" style="top:520px;left:430px;width:530px">' + (ate ? 'Fica cinza no fim da lista e fora da contagem do topo. Volta sozinho quando o prazo acabar ou o item mudar de estado.' :
        'Silenciar tira da contagem do topo e manda para o fim da lista. Se o item mudar de estado (por exemplo, virar problema), ele volta na hora.') + '</div>';
      if (ate) { s += '<div class="btn mfbtn" style="left:18px;top:522px;width:190px" data-act="mon-sil" data-arg="0">Voltar a avisar</div>'; }
      else {
        s += '<div class="btn mfbtn" style="left:18px;top:522px;width:126px" data-act="mon-sil" data-arg="1">Silenciar 1 dia</div>';
        s += '<div class="btn mfbtn" style="left:152px;top:522px;width:126px" data-act="mon-sil" data-arg="7">7 dias</div>';
        s += '<div class="btn mfbtn" style="left:286px;top:522px;width:126px" data-act="mon-sil" data-arg="30">30 dias</div>';
      }
    }
    U.html('mFichaCorpo', s);
  }

  /* ---------- 1.8: fichas do rob\u00f4 e da VM, e o mapa dos 7 dias ---------- */
  function blocoSilencio(it, ate) {
    var s = '<div class="mfl" style="left:18px;top:504px">' + (ate ? 'SILENCIADO AT\u00c9 ' + U.esc(quandoTxt(ate)).toUpperCase() : 'J\u00c1 SABE DISSO?') + '</div>';
    s += '<div class="mfnota" style="top:520px;left:430px;width:530px">' + (ate ? 'Fica cinza no fim da lista e fora da contagem do topo. Volta sozinho quando o prazo acabar ou o item mudar de estado.' :
      'Silenciar tira da contagem do topo e do cart\u00e3o de aten\u00e7\u00e3o. Se mudar de estado (por exemplo, falhar de novo), volta na hora.') + '</div>';
    if (ate) { return s + '<div class="btn mfbtn" style="left:18px;top:522px;width:190px" data-act="mon-sil" data-arg="0">Voltar a avisar</div>'; }
    return s + '<div class="btn mfbtn" style="left:18px;top:522px;width:126px" data-act="mon-sil" data-arg="1">Silenciar 1 dia</div>' +
      '<div class="btn mfbtn" style="left:152px;top:522px;width:126px" data-act="mon-sil" data-arg="7">7 dias</div>' +
      '<div class="btn mfbtn" style="left:286px;top:522px;width:126px" data-act="mon-sil" data-arg="30">30 dias</div>';
  }
  var DICA_ROBO = {
    desktop: 'Veja se o computador dos rob\u00f4s est\u00e1 ligado, com a sess\u00e3o do Windows aberta e sem ningu\u00e9m usando. No Power Automate (make.powerautomate.com \u203a Meus fluxos), a execu\u00e7\u00e3o que falhou mostra em que passo parou; para rodar agora, toque em Executar.',
    pbi: 'No Power Automate, abra a execu\u00e7\u00e3o que falhou. Se a conex\u00e3o do Power BI pedir login, entre de novo em Dados \u203a Conex\u00f5es; se o Power BI recusou por j\u00e1 ter uma atualiza\u00e7\u00e3o rodando, a pr\u00f3xima tentativa resolve.',
    nuvem: 'No Power Automate (make.powerautomate.com \u203a Meus fluxos), abra a execu\u00e7\u00e3o que falhou: ela mostra qual a\u00e7\u00e3o parou e por qu\u00ea.',
    atrasado: 'No Power Automate, veja se o fluxo continua ligado e se a assinatura est\u00e1 ativa. Para rodar agora, abra o fluxo e toque em Executar.',
    lento: 'No computador dos rob\u00f4s, veja se alguma janela ficou esperando resposta. Pelo Power Automate d\u00e1 para cancelar a execu\u00e7\u00e3o e rodar de novo.',
    suspenso: 'No Power Automate, abra o fluxo: o aviso no alto da p\u00e1gina diz por que ele foi suspenso e o que corrigir antes de ligar de novo.'
  };
  function renderRobo() {
    var r = roboDe(m.fichaId), agora = agoraMs(), itens = itensDo('ferramentas'), it = null, i;
    if (!r) { fecharFicha(); return; }
    for (i = 0; i < itens.length; i++) { if (itens[i].rb === r.id) { it = itens[i]; } }
    m.fichaItem = it; // o alerta do rob\u00f4 pode ter aparecido ou sumido desde que a ficha abriu
    var sit = sitRobo(r), ate = it ? silenciado(it) : 0, h = r.h || [], mod = quando(r.mod), prox = quando(r.prox);
    var tipo = r.tipo === 'desktop' ? 'rob\u00f4 de desktop' + (r.passos > 1 ? ' (' + r.passos + ' passos)' : '') : (r.tipo === 'pbi' ? 'manda atualizar ' + (r.alvo ? 'o modelo ' + r.alvo : 'um modelo') + ' no Power BI' : 'fluxo de nuvem');
    var s = '<div class="ptit">Rob\u00f4 ' + U.esc(r.nome || '') + '</div><div class="mfp"><span class="pill ' + (ate ? 'cinza' : sit[0]) + '">' + (ate ? 'SILENCIADO' : sit[1]) + '</span></div>';
    s += '<div class="mfsub">' + U.esc('Power Automate \u00b7 ' + tipo + (mod !== null ? ' \u00b7 alterado pela \u00faltima vez em ' + U.pad2(local(mod).getDate()) + '/' + U.pad2(local(mod).getMonth() + 1) + '/' + local(mod).getFullYear() : '')) + '</div>';
    // quatro n\u00fameros
    var u = h[0], ultV = '\u2014', ultS = '';
    if (u) {
      var ini = u[1] * 1000;
      if (u[0] === 'U') { ultV = 'rodando'; ultS = 'desde ' + diaTxt(ini) + ' (h\u00e1 ' + durCurta(agora - ini) + ')'; }
      else { ultV = diaTxt(ini); ultS = (u[0] === 'C' ? 'deu certo \u00b7 levou ' : (u[0] === 'F' ? 'falhou depois de ' : 'cancelada depois de ')) + durLonga(u[2]); }
    }
    s += bloco(18, '\u00daLTIMA EXECU\u00c7\u00c3O', ultV, ultS);
    s += bloco(266, 'AGENDA', r.ag ? r.ag.charAt(0).toUpperCase() + r.ag.slice(1) : '\u2014', r.estado === 'off' ? 'desligado: n\u00e3o est\u00e1 rodando' : (prox !== null ? 'pr\u00f3xima: ' + diaTxt(prox) : ''));
    s += bloco(514, 'DURA\u00c7\u00c3O NORMAL', r.medS ? durLonga(r.medS) : '\u2014', r.medS ? 'das execu\u00e7\u00f5es que deram certo' : '');
    s += bloco(762, 'DERAM CERTO', r.n ? r.ok + ' de ' + r.n : '\u2014', r.n ? 'sem contar as canceladas' : '');
    // hist\u00f3rico
    s += '<div class="mfl" style="left:18px;top:178px">\u00daLTIMAS ' + h.length + ' EXECU\u00c7\u00d5ES \u00b7 a altura \u00e9 o tempo que levou \u00b7 vermelho = falhou \u00b7 \u00e2mbar = cancelada \u00b7 azul = rodando</div>';
    s += '<div class="mfbar">' + barras(h, 20, 40, 7, 84) + '</div>';
    if (h.length) { s += '<div class="mfcap" style="left:18px">' + diaTxt(h[h.length - 1][1] * 1000) + '</div><div class="mfcap" style="right:18px;text-align:right">' + diaTxt(h[0][1] * 1000) + '</div>'; }
    // o que o Monitor viu (sem repetir o que j\u00e1 est\u00e1 nos quatro n\u00fameros) e o que fazer
    var ps = partes(r.det), viu = [], ruim = r.estado === 'erro' || r.estado === 'alerta', pode = !!it && podeSilenciar(it), limite = pode ? 498 : 566;
    for (i = 0; i < ps.length; i++) { if (!/^(Roda |Leva uns |Sem agenda marcada|\d+ de \d+ deram certo)/.test(ps[i])) { viu.push(ps[i]); } }
    var dica = ruim ? (r.sit === 'falhou' ? (DICA_ROBO[r.tipo] || DICA_ROBO.nuvem) : (DICA_ROBO[r.sit] || '')) : '';
    if (!ruim && r.estado !== 'off') {
      // em dia: o que ajuda a ler o hist\u00f3rico acima
      var nF = 0, ultF = 0;
      for (i = 0; i < h.length; i++) { if (h[i][0] === 'F') { nF++; if (!ultF) { ultF = h[i][1] * 1000; } } }
      viu.push(nF ? nF + ' ' + U.plural(nF, 'falha', 'falhas') + ' nas \u00faltimas ' + h.length + ' execu\u00e7\u00f5es; a mais recente, ' + diaTxt(ultF) : 'Nenhuma falha nas \u00faltimas ' + h.length + ' execu\u00e7\u00f5es');
      if (r.tipo === 'desktop') { viu.push('Rob\u00f4 de desktop: precisa do computador dos rob\u00f4s ligado, com a sess\u00e3o do Windows aberta'); }
      else if (r.tipo === 'pbi') { viu.push('S\u00f3 faz o pedido ao Power BI; se a atualiza\u00e7\u00e3o em si deu certo aparece na ficha do modelo' + (r.alvo ? ' ' + r.alvo : '')); }
    }
    if (!viu.length) { viu = ps; }
    s += '<div class="mfx" style="top:320px;max-height:' + (limite - 320) + 'px">';
    if (viu.length) {
      s += '<div class="mfl2">' + (ruim ? 'O QUE O MONITOR VIU' : (r.estado === 'off' ? 'SITUA\u00c7\u00c3O' : 'COMO ELE VEM RODANDO')) + '</div>';
      for (i = 0; i < viu.length && i < (dica ? 3 : 5); i++) { s += '<div class="mfx1"><b>\u203a</b> ' + U.esc(viu[i]) + '</div>'; }
    }
    if (dica) { s += '<div class="mfl2' + (viu.length ? ' esp' : '') + '">O QUE FAZER</div><div class="mfx1 dica">' + U.esc(dica) + '</div>'; }
    s += '</div>';
    if (pode) { s += blocoSilencio(it, ate); }
    else if (!ruim) { s += '<div class="mfnota" style="top:540px">O Monitor s\u00f3 l\u00ea: se o fluxo est\u00e1 ligado, a agenda e o resultado das execu\u00e7\u00f5es. N\u00e3o liga, desliga, edita nem dispara nada.</div>'; }
    U.html('mFichaCorpo', s);
  }
  /* VM do Google: os quatro sinais (disponibilidade, tempo de resposta, consultas e fila), as \u00faltimas 24 horas e o que \u00e9 conferido */
  function estadoDe(chave) {
    var itens = itensDo('ferramentas'), i;
    for (i = 0; i < itens.length; i++) { if (itens[i].chave === chave) { return itens[i]; } }
    return null;
  }
  function numBR(v, casas) { var f = Math.pow(10, casas || 0); return String(Math.round(v * f) / f).replace('.', ','); }
  function bytesTxt(b) { return b >= 0.95 * 1073741824 ? numBR(b / 1073741824, 1) + ' GB' : Math.max(0, Math.round(b / 1048576)) + ' MB'; }
  /* bloco com barrinha de porcentagem (uso da m\u00e1quina) */
  function blocoU(x, y, rotulo, valor, sub, pct, nivel) {
    var cor = nivel === 'ru' ? '#ff7a7a' : (nivel === 'am' ? '#f59e0b' : '#22d3ee');
    return '<div class="mfb" style="left:' + x + 'px;top:' + y + 'px"><div class="mfl">' + rotulo + '</div><div class="mfv' + (nivel ? ' ' + nivel : '') + '">' + U.esc(valor) + '</div>' +
      (pct === null || pct === undefined ? '' : '<div class="mfpb"><i style="width:' + Math.max(2, Math.min(100, Math.round(pct))) + '%;background:' + cor + '"></i></div>') +
      '<div class="mfs">' + U.esc(sub || '') + '</div></div>';
  }
  function bloco2(x, y, rotulo, valor, sub) {
    return '<div class="mfb" style="left:' + x + 'px;top:' + y + 'px"><div class="mfl">' + rotulo + '</div><div class="mfv">' + U.esc(valor) + '</div><div class="mfs">' + U.esc(sub || '') + '</div></div>';
  }
  function diaMesTxt(ms) { var d = local(ms); return U.pad2(d.getDate()) + '/' + U.pad2(d.getMonth() + 1); }
  function renderVm(it) {
    var v = it.vm, d = m.dados, agora = agoraMs(), est = NOME_EST[it.estado] || NOME_EST.info, ate = silenciado(it), t = quando(it.quando), desde = quando(v.desde), ger = d ? quando(d.gerado) : null, i, k;
    var mq = v.maq && usoCurto(v.maq) ? v.maq : null, bot = estadoDe('vm|whatsapp'), y0 = mq ? 272 : 178;
    var s = '<div class="ptit">' + U.esc(it.nome || '') + '</div><div class="mfp"><span class="pill ' + (ate ? 'cinza' : est[0]) + '">' + (ate ? 'SILENCIADO' : (it.estado === 'ok' ? 'NO AR' : est[1])) + '</span></div>';
    s += '<div class="mfsub">' + U.esc((it.valor || '') + (it.estado !== 'ok' && t !== null ? ' \u00b7 desde ' + quandoTxt(t) + ' (' + idadeTxt(agora - t) + ')' : (desde !== null ? ' \u00b7 sem falha desde ' + quandoTxt(desde) : '')) +
      (v.v ? ' \u00b7 API v' + v.v : '') + (v.host ? ' \u00b7 ' + v.host + (v.ip ? ' (' + v.ip + ')' : '') : '')) + '</div>';
    var temUp = v.up !== null && v.up !== undefined;
    s += bloco(18, 'DISPONIBILIDADE \u00b7 24 H', temUp ? pctTxt(v.up) : '\u2014', v.n ? v.n + ' ' + U.plural(v.n, 'confer\u00eancia', 'confer\u00eancias') + ' \u00b7 ' + (v.f ? v.f + ' sem resposta' : 'nenhuma sem resposta') + (v.up7 !== undefined ? ' \u00b7 7 dias: ' + pctTxt(v.up7) : '') : '');
    s += bloco(266, 'TEMPO DE RESPOSTA', v.lat ? segTxt(v.lat[0]) : '\u2014', v.lat ? '1 em cada 10 passa de ' + segTxt(v.lat[1]) + ' \u00b7 medido do PC do coletor' : '');
    if (bot && bot.n) {
      s += bloco(514, 'USO HOJE', bot.n[0] + ' ' + U.plural(bot.n[0], 'nota', 'notas'), 'no WhatsApp \u00b7 ' + (v.hoje || 0) + ' ' + U.plural(v.hoje || 0, 'consulta', 'consultas') + ' da API \u00b7 no m\u00eas: ' + bot.n[1] + ' notas' + (typeof v.mes === 'number' ? ' e ' + v.mes + ' consultas' : ''));
    } else {
      s += bloco(514, 'CONSULTAS HOJE', String(v.hoje || 0), (v.lote ? v.lote + ' ' + U.plural(v.lote, 'nota de lote pendente', 'notas de lote pendentes') + ' \u00b7 ' : '') + 'pedidos do Protheus \u00e0 API');
    }
    s += bloco(762, 'FILA', v.fila ? v.fila[0] + (v.fila[1] ? ' de ' + v.fila[1] : '') : '\u2014', (v.sim ? v.sim[0] + (v.sim[1] ? ' de ' + v.sim[1] : '') + ' em andamento' : '') + (v.rec ? ' \u00b7 ' + v.rec + ' ' + U.plural(v.rec, 'recusada', 'recusadas') : ' \u00b7 nenhuma recusada'));
    if (mq) {
      // uso da m\u00e1quina: o que a pr\u00f3pria API informa (CPU desde a leitura anterior, mem\u00f3ria, disco e o que a placa de rede mandou no m\u00eas)
      var cpuN = typeof mq.cpu === 'number' ? mq.cpu : null;
      s += blocoU(18, 176, 'CPU', cpuN !== null ? Math.round(cpuN) + '%' : '\u2014', (mq.carga !== undefined ? 'carga ' + numBR(mq.carga, 2) + ' em ' : '') + (mq.nucleos || 1) + ' n\u00facleos' + (mq.roubada >= 5 ? ' \u00b7 o Google segurou ' + Math.round(mq.roubada) + '%' : ''), cpuN, cpuN !== null && cpuN >= 85 ? 'am' : '');
      if (mq.mem) {
        var memN = mq.mem[2] < 0.1 * mq.mem[1] ? 'ru' : (mq.mem[0] >= 85 || (mq.swap && mq.swap[0] > 0.8 * mq.swap[1]) ? 'am' : '');
        s += blocoU(266, 176, 'MEM\u00d3RIA', mq.mem[0] + '%', (mq.mem[1] - mq.mem[2]) + ' de ' + mq.mem[1] + ' MB em uso' + (mq.swap ? ' \u00b7 swap: ' + mq.swap[0] + ' de ' + mq.swap[1] + ' MB' : ''), mq.mem[0], memN);
      }
      if (mq.disco) {
        s += blocoU(514, 176, 'DISCO', mq.disco[0] + '%', numBR(mq.disco[1] - mq.disco[2], 1) + ' de ' + numBR(mq.disco[1], 1) + ' GB \u00b7 ' + numBR(mq.disco[2], 1) + ' GB livres', mq.disco[0], mq.disco[0] >= 95 ? 'ru' : (mq.disco[0] >= 85 ? 'am' : ''));
      }
      if (mq.rede) {
        var rd = mq.rede, desdeR = quando(rd.desde), gr = rd.gratis || 1073741824;
        s += blocoU(762, 176, 'REDE \u00b7 ENVIADO NO M\u00caS', bytesTxt(rd.tx), (desdeR !== null ? 'desde ' + diaMesTxt(desdeR) + ' \u00b7 ' : '') + 'o plano gr\u00e1tis cobre ' + bytesTxt(gr) + ' por m\u00eas', 100 * rd.tx / gr, rd.tx > 0.8 * gr ? 'am' : '');
      }
    }
    // as \u00faltimas 24 horas
    s += '<div class="mfl" style="left:18px;top:' + y0 + 'px">\u00daLTIMAS 24 HORAS \u00b7 verde = respondeu sempre \u00b7 \u00e2mbar = falhou alguma vez \u00b7 vermelho = fora do ar \u00b7 escuro = sem registro</div><div class="mfvm" style="top:' + (y0 + 18) + 'px">';
    for (k = 0; k < 24; k++) { s += '<i style="left:' + (k * 39) + 'px;background:' + (COR_FX[String(v.fx || '').charAt(k)] || '#0e2238') + '"></i>'; }
    s += '</div>';
    if (ger !== null) {
      var hFim = Math.floor(ger / 3600000);
      for (k = 0; k < 24; k++) {
        var hr = local((hFim - 23 + k) * 3600000).getHours();
        if (k === 23) { s += '<div class="mhr" style="left:' + (18 + k * 39 - 3) + 'px;top:' + (y0 + 46) + 'px">agora</div>'; }
        else if (hr % 3 === 0 && k < 22) { s += '<div class="mhr" style="left:' + (18 + k * 39 - 3) + 'px;top:' + (y0 + 46) + 'px">' + U.pad2(hr) + 'h</div>'; }
      }
    }
    var pode = podeSilenciar(it), limite = pode ? 498 : 566, linhas = [], dica = dicaItem(it), rot = 'O QUE O MONITOR CONFERE', yl = y0 + 74;
    if (it.estado !== 'ok') { linhas = partes(it.detalhe).slice(0, 3); rot = 'O QUE O MONITOR VIU'; }
    else {
      var gc = estadoDe('gc|status'), cl = estadoDe('cl|status');
      if (mq && mq.boot) {
        var bt = quando(mq.boot);
        linhas.push('Ligada desde ' + quandoTxt(bt) + ' (h\u00e1 ' + durCurta(agora - bt) + ')' + (mq.proc ? ' \u00b7 a API usa ' + (mq.proc.api || '?') + ' MB e o bot ' + (mq.proc.whatsapp || '?') + ' MB (sem os classificadores que ele abre)' : ''));
      } else {
        linhas.push('A API responde: conferido a cada ' + ((d && d.pc && d.pc.intervaloMin) || 5) + ' min, de fora, sem senha nem token');
      }
      if (bot) { linhas.push('Bot do WhatsApp: ' + (bot.estado === 'ok' ? '' : bot.valor + ' \u00b7 ') + partes(bot.detalhe).slice(0, 1).join('').replace(/^Servi\u00e7o ativo e conectado ao WhatsApp$/, 'conectado') + (/\u00faltima atividade/.test(bot.detalhe) ? ' \u00b7 ' + /\u00faltima atividade[^\u00b7]*/.exec(bot.detalhe)[0].replace(/\s+$/, '') : '')); }
      if (typeof v.a1 === 'number') { var a1 = local(agora + v.a1 * 86400000); linhas.push('Certificado A1 da empresa: vence em ' + U.pad2(a1.getDate()) + '/' + U.pad2(a1.getMonth() + 1) + '/' + a1.getFullYear() + ' (' + v.a1 + ' dias)' + (typeof v.https === 'number' ? ' \u00b7 HTTPS do dom\u00ednio: mais ' + v.https + ' dias' : '')); }
      else if (typeof v.https === 'number') { linhas.push('HTTPS do dom\u00ednio: v\u00e1lido por mais ' + v.https + ' dias (o Caddy da VM renova sozinho)'); }
      linhas.push('Google Cloud, onde a VM roda: ' + (gc ? (gc.estado === 'ok' ? 'sem incidente aberto na regi\u00e3o' : gc.valor) : 'sem leitura agora') + ' \u00b7 API do Claude, que o bot consulta: ' + (cl ? cl.valor : 'sem leitura agora'));
      if (!mq) { linhas.push('Uso da m\u00e1quina (CPU, mem\u00f3ria, disco, rede): aparece quando a API do bot publicar esses n\u00fameros no /saude'); }
    }
    s += '<div class="mfx" style="top:' + yl + 'px;max-height:' + (limite - yl) + 'px"><div class="mfl2">' + rot + '</div>';
    for (i = 0; i < linhas.length; i++) { s += '<div class="mfx1"><b>\u203a</b> ' + U.esc(linhas[i]) + '</div>'; }
    if (dica) { s += '<div class="mfl2 esp">O QUE FAZER</div><div class="mfx1 dica">' + U.esc(dica) + '</div>'; }
    s += '</div>';
    if (pode) { s += blocoSilencio(it, ate); }
    U.html('mFichaCorpo', s);
  }
  /* mapa dos 7 dias: uma linha por modelo, uma coluna por dia (o coletor guarda o registro das atualiza\u00e7\u00f5es) */
  function renderMapa7() {
    var d = m.dados, mods = ordenarModelos(modelosDo('bi')), ger = d ? quando(d.gerado) : null, i, k;
    if (!mods.length || ger === null) { fecharFicha(); return; }
    var X0 = 262, P = 84, W = 80, tot = [], tOk = 0, tF = 0, semReg = -1;
    for (k = 0; k < 7; k++) { tot.push([0, 0, 0]); }
    var comD7 = 0;
    var livre = 440 - 26, alt = Math.max(14, Math.min(24, Math.floor(livre / mods.length))), cabem = Math.floor(livre / alt);
    var lista = mods.length > cabem ? mods.slice(0, cabem - 1) : mods;
    for (i = 0; i < mods.length; i++) {
      var dm = mods[i].d7 && mods[i].d7.length === 7 ? mods[i].d7 : null;
      if (dm) { comD7++; }
      for (k = 0; k < 7; k++) { if (dm && dm[k]) { tot[k][0] += dm[k][0]; tot[k][1] += dm[k][1]; tot[k][2]++; tOk += dm[k][0]; tF += dm[k][1]; } }
    }
    // dia em que menos da metade dos modelos tem registro: a soma n\u00e3o quer dizer nada, e o registro ainda n\u00e3o tinha come\u00e7ado
    for (k = 0; k < 7; k++) { if (tot[k][2] * 2 < comD7 || !tot[k][2]) { semReg = k; tot[k][2] = 0; } }
    var s = '<div class="ptit">Os \u00faltimos 7 dias, dia a dia</div><div class="mfp"><span class="pill ' + (tF ? 'ambar' : 'verde') + '">' + tOk + ' CERTAS \u00b7 ' + tF + ' ' + (tF === 1 ? 'FALHA' : 'FALHAS') + '</span></div>';
    s += '<div class="mfsub">Uma linha por modelo \u00b7 o n\u00famero \u00e9 quantas atualiza\u00e7\u00f5es deram certo no dia \u00b7 \u2717 = falhas \u00b7 escuro = sem atualiza\u00e7\u00e3o \u00b7 toque num modelo para abrir</div>';
    for (k = 0; k < 7; k++) {
      var dd = local(ger - (6 - k) * 86400000);
      s += '<div class="mmh' + (k === 6 ? ' meia' : '') + '" style="left:' + (X0 + k * P) + 'px;width:' + W + 'px">' + (k === 6 ? 'hoje' : DIA_C[dd.getDay()] + ' ' + U.pad2(dd.getDate())) + '</div>';
    }
    s += '<div class="mmh meia" style="left:' + (X0 + 7 * P + 6) + 'px;width:96px;text-align:right">7 dias</div>';
    function celula(c, x, y2, h2) {
      if (!c) { return '<i class="mm7 sem" style="left:' + x + 'px;top:' + y2 + 'px;width:' + W + 'px;height:' + h2 + 'px;line-height:' + h2 + 'px"></i>'; }
      var a = c[0], b = c[1], cor = b ? (a ? '#f59e0b' : '#ff7a7a') : (a ? '#2f9e68' : '#0e2238');
      return '<i class="mm7' + (a + b ? '' : ' vazio') + '" style="left:' + x + 'px;top:' + y2 + 'px;width:' + W + 'px;height:' + h2 + 'px;line-height:' + h2 + 'px;background:' + cor + '">' + (a + b ? a + (b ? ' \u00b7 ' + b + ' \u2717' : '') : '') + '</i>';
    }
    function pctDe(a, b) {
      if (!(a + b)) { return '<div class="mm7p" style="left:' + (X0 + 7 * P + 6) + 'px">\u2014</div>'; }
      var pc = Math.floor(a / (a + b) * 1000) / 10;
      return '<div class="mm7p' + (pc < 95 ? ' pes' : (pc < 99 ? ' ruim' : '')) + '" style="left:' + (X0 + 7 * P + 6) + 'px">' + pctTxt(pc) + '</div>';
    }
    var y = 96;
    for (i = 0; i < lista.length; i++) {
      var mo = lista[i], est = COR[mo.estado] ? mo.estado : 'info', d7 = mo.d7 && mo.d7.length === 7 ? mo.d7 : null, a7 = 0, b7 = 0;
      s += '<div class="mmrow" data-act="mon-mapa-modelo" data-arg="' + U.esc(mo.id || '') + '" style="top:' + y + 'px;height:' + alt + 'px">' +
        '<i class="md ' + est + '" style="background:' + COR[est] + ';top:' + Math.round(alt / 2 - 4) + 'px;width:8px;height:8px;left:18px"></i>' +
        '<div class="mmq" style="line-height:' + alt + 'px">' + U.esc(mo.nome || '') + '</div>';
      for (k = 0; k < 7; k++) {
        var c = d7 ? d7[k] : null;
        if (c) { a7 += c[0]; b7 += c[1]; }
        s += celula(c, X0 + k * P, 2, alt - 4);
      }
      s += '<div style="position:absolute;top:0;left:0;line-height:' + alt + 'px">' + pctDe(a7, b7) + '</div></div>';
      y += alt;
    }
    if (lista.length < mods.length) { s += '<div class="mfnota" style="top:' + (y + 2) + 'px">+ ' + (mods.length - lista.length) + ' outros modelos (a lista do BI mostra todos)</div>'; y += alt; }
    y += 8;
    s += '<div class="mmrow tot" style="top:' + y + 'px;height:24px"><div class="mmq forte" style="line-height:24px">Todos os modelos</div>';
    for (k = 0; k < 7; k++) { s += celula(tot[k][2] ? tot[k] : null, X0 + k * P, 2, 20); }
    s += '<div style="position:absolute;top:0;left:0;line-height:24px">' + pctDe(tOk, tF) + '</div></div>';
    y += 30;
    if (semReg >= 0) {
      var d1 = local(ger - (6 - (semReg + 1)) * 86400000);
      s += '<div class="mfnota" style="top:' + Math.min(y + 2, 548) + 'px">O registro das atualiza\u00e7\u00f5es come\u00e7ou ' + (semReg >= 5 ? 'hoje' : DIA_C[d1.getDay()] + ' ' + U.pad2(d1.getDate()) + '/' + U.pad2(d1.getMonth() + 1)) + ': os dias anteriores ficam vazios (ou s\u00f3 com os modelos de 1 vez por dia) e entram sozinhos com o tempo.</div>';
    }
    U.html('mFichaCorpo', s);
  }

  /* ---------- mapa das 24 horas (1.7): uma linha por modelo, uma coluna por hora ---------- */
  var COR_FX = { o: '#2f9e68', m: '#f59e0b', x: '#ff7a7a' };
  function renderMapa() {
    var d = m.dados, g = grupoDados('bi') || {}, r = g.resumo || {}, mods = ordenarModelos(modelosDo('bi')), ger = d ? quando(d.gerado) : null, i, k;
    if (!mods.length || ger === null) { fecharFicha(); return; }
    var hFim = Math.floor(ger / 3600000), X0 = 262, P = 29, W = 25;
    var gw = null, fer = itensDo('ferramentas');
    for (i = 0; i < fer.length; i++) { if (fer[i].carga && fer[i].carga.hh && fer[i].carga.hh.length === 24 && !gw) { gw = fer[i]; } }
    var hh = r.hh && r.hh.length === 24 ? r.hh : null, extras = (hh ? 1 : 0) + (gw ? 1 : 0);
    var livre = 440 - extras * 26, alt = Math.max(14, Math.min(24, Math.floor(livre / mods.length))), cabem = Math.floor(livre / alt);
    var lista = mods.length > cabem ? mods.slice(0, cabem - 1) : mods;
    var h24 = r.h24 || [0, 0];
    var s = '<div class="ptit">As \u00faltimas 24 horas, hora a hora</div><div class="mfp"><span class="pill ' + (h24[1] ? 'ambar' : 'verde') + '">' + h24[0] + ' CERTAS \u00b7 ' + h24[1] + ' ' + (h24[1] === 1 ? 'FALHA' : 'FALHAS') + '</span></div>';
    s += '<div class="mfsub">Uma linha por modelo \u00b7 verde = deu certo \u00b7 \u00e2mbar = parte falhou \u00b7 vermelho = falhou \u00b7 escuro = sem atualiza\u00e7\u00e3o \u00b7 toque num modelo para abrir</div>';
    // horas no alto (a \u00faltima coluna \u00e9 a hora atual, ainda pela metade)
    for (k = 0; k < 24; k++) {
      var hr = local((hFim - 23 + k) * 3600000).getHours();
      if (k === 23) { s += '<div class="mmh" style="left:' + (X0 + k * P - 6) + 'px;width:' + (W + 12) + 'px">agora</div>'; }
      else if (hr % 3 === 0 && k < 22) { s += '<div class="mmh' + (hr === 0 ? ' meia' : '') + '" style="left:' + (X0 + k * P - 6) + 'px;width:' + (W + 12) + 'px">' + U.pad2(hr) + 'h</div>'; }
      if (hr === 0 && k > 0) { s += '<b class="mmv" style="left:' + (X0 + k * P - 3) + 'px;height:' + (Math.min(lista.length, cabem) * alt + extras * 26 + 14) + 'px"></b>'; }
    }
    var y = 96;
    for (i = 0; i < lista.length; i++) {
      var mo = lista[i], fx = mo.faixa && mo.faixa.length === 24 ? mo.faixa : '', est = COR[mo.estado] ? mo.estado : 'info';
      s += '<div class="mmrow" data-act="mon-mapa-modelo" data-arg="' + U.esc(mo.id || '') + '" style="top:' + y + 'px;height:' + alt + 'px">' +
        '<i class="md ' + est + '" style="background:' + COR[est] + ';top:' + Math.round(alt / 2 - 4) + 'px;width:8px;height:8px;left:18px"></i>' +
        '<div class="mmq" style="line-height:' + alt + 'px">' + U.esc(mo.nome || '') + '</div>';
      for (k = 0; k < 24; k++) {
        var ch = fx ? fx.charAt(k) : '.';
        s += '<i class="mmc" style="left:' + (X0 + k * P) + 'px;top:2px;width:' + W + 'px;height:' + (alt - 4) + 'px;background:' + (COR_FX[ch] || '#0e2238') + '"></i>';
      }
      s += '</div>';
      y += alt;
    }
    if (lista.length < mods.length) { s += '<div class="mfnota" style="top:' + (y + 2) + 'px">+ ' + (mods.length - lista.length) + ' outros modelos (a lista do BI mostra todos)</div>'; y += alt; }
    y += 8;
    // soma de todos os modelos: quantas atualiza\u00e7\u00f5es terminaram em cada hora
    var maisF = -1, nMaisF = 0, maisA = -1, nMaisA = 0;
    if (hh) {
      s += '<div class="mmrow tot" style="top:' + y + 'px;height:24px"><div class="mmq forte" style="line-height:24px">Todos os modelos</div>';
      for (k = 0; k < 24; k++) {
        var a = hh[k][0], b = hh[k][1], cor = b ? (a ? '#f59e0b' : '#ff7a7a') : (a ? '#2f9e68' : '#0e2238');
        if (b > nMaisF) { nMaisF = b; maisF = k; }
        if (a + b > nMaisA) { nMaisA = a + b; maisA = k; }
        s += '<i class="mmc num" style="left:' + (X0 + k * P) + 'px;top:2px;width:' + W + 'px;height:20px;line-height:20px;background:' + cor + '">' + (a + b ? a + b : '') + '</i>';
      }
      s += '</div>';
      y += 26;
    }
    if (gw) {
      var cg = gw.carga, pmax = 1;
      for (k = 0; k < 24; k++) { if (cg.hh[k][1] > pmax) { pmax = cg.hh[k][1]; } }
      var gh0 = quando(cg.h0), desloc = gh0 !== null ? Math.round((gh0 / 3600000) - (hFim - 23)) : 0;
      s += '<div class="mmrow tot" style="top:' + y + 'px;height:24px"><div class="mmq forte" style="line-height:24px">' + U.esc(gw.nome || 'Gateway') + ' \u00b7 pico</div>';
      for (k = 0; k < 24; k++) {
        var j = k - desloc, pk = j >= 0 && j < 24 ? cg.hh[j][1] : 0, op = pk ? 0.18 + 0.82 * pk / pmax : 0;
        s += '<i class="mmc num gwc" style="left:' + (X0 + k * P) + 'px;top:2px;width:' + W + 'px;height:20px;line-height:20px;background:' + (pk ? 'rgba(34,211,238,' + op.toFixed(2) + ')' : '#0e2238') + (pk / pmax > 0.55 ? ';color:#04101c' : ';color:#cfe3ff') + '">' + (pk || '') + '</i>';
      }
      s += '</div>';
      y += 26;
    }
    // o que chama aten\u00e7\u00e3o no dia
    var notas = [];
    if (nMaisF >= 2) { notas.push('hora com mais falhas: ' + horaDe((hFim - 23 + maisF) * 3600000) + ' (' + nMaisF + ')'); }
    if (nMaisA > 0) { notas.push('hora mais cheia: ' + horaDe((hFim - 23 + maisA) * 3600000) + ' (' + nMaisA + ' atualiza\u00e7\u00f5es)'); }
    if (notas.length) { s += '<div class="mfnota" style="top:' + Math.min(y + 6, 548) + 'px">' + U.esc(notas.join(' \u00b7 ')) + '</div>'; }
    U.html('mFichaCorpo', s);
  }

  function render() {
    if (!U) { return; }
    m.ultimoRender = agoraMs();
    seguro('topo', renderHero);
    seguro('cart\u00f5es', renderGrupos);
    seguro('lista', renderDetalhe);
    seguro('ficha', renderFicha);
    seguro('alarme', verificarAlarme);
    seguro('bot\u00f5es', renderAlarmeBotao);
    seguro('noite', renderNoite);
  }

  /* ---------- som do alarme ----------
     O iOS s\u00f3 deixa tocar som depois de um toque na tela. O <audio> toca mesmo com o iPad no silencioso;
     o Web Audio fica de reserva, se o arquivo n\u00e3o tocar. */
  /* o mesmo alarme (3 pares de bipes) gerado aqui como WAV de 8 bits: toca sem depender da internet nem do certificado do site */
  function wavBipes() {
    var taxa = 11025, partes = [[988, 0.15], [0, 0.05], [740, 0.15], [0, 0.05]], a = [], i, j, k, n;
    for (k = 0; k < 3; k++) {
      for (j = 0; j < partes.length; j++) {
        n = Math.round(taxa * partes[j][1]);
        for (i = 0; i < n; i++) {
          var env = Math.min(1, i / 40, (n - 1 - i) / 40);
          a.push(partes[j][0] ? 128 + Math.round(110 * env * (Math.sin(2 * Math.PI * partes[j][0] * i / taxa) >= 0 ? 1 : -1)) : 128);
        }
      }
    }
    function u32(v) { return String.fromCharCode(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255); }
    function u16(v) { return String.fromCharCode(v & 255, (v >> 8) & 255); }
    var c = 'RIFF' + u32(36 + a.length) + 'WAVEfmt ' + u32(16) + u16(1) + u16(1) + u32(taxa) + u32(taxa) + u16(1) + u16(8) + 'data' + u32(a.length), pedaco = [];
    for (i = 0; i < a.length; i++) { pedaco.push(String.fromCharCode(a[i])); }
    return 'data:audio/wav;base64,' + window.btoa(c + pedaco.join(''));
  }
  function ouvirSom(el, k) {
    el.addEventListener('playing', function () { som[k + 'Ok'] = true; som[k + 'Erro'] = 0; }, false);
    el.addEventListener('error', function () { som[k + 'Ok'] = false; som[k + 'Erro'] = (el.error && el.error.code) || -1; }, false);
  }
  function prepararSom(vaiTocar) {
    if (!som.el) {
      som.el = U.$('mSom');
      if (som.el) { ouvirSom(som.el, 'el'); }
    }
    if (!som.el2) {
      try { som.el2 = document.createElement('audio'); som.el2.preload = 'auto'; som.el2.src = wavBipes(); ouvirSom(som.el2, 'el2'); } catch (e0) { som.el2 = null; }
    }
    // o iOS s\u00f3 deixa tocar depois sozinho o que foi preparado dentro de um toque
    if (!som.liberado && !vaiTocar) {
      try { if (som.el) { som.el.load(); } } catch (e) { /* nada */ }
      try { if (som.el2) { som.el2.load(); } } catch (e1) { /* nada */ }
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
    // a voz tamb\u00e9m precisa de um primeiro uso dentro de um toque
    if (!som.liberado && voz.ok) {
      try { var u = new window.SpeechSynthesisUtterance(' '); u.volume = 0; window.speechSynthesis.speak(u); } catch (e3) { /* sem voz */ }
    }
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
  /* toca o alarme pelo primeiro jeito que funciona: o som guardado no app, o arquivo do site e, de reserva, o bipe do Web Audio */
  function tocar() {
    var lista = [[som.el2, 'el2'], [som.el, 'el']], i;
    for (i = 0; i < lista.length; i++) {
      var el = lista[i][0], k = lista[i][1];
      if (!el || som[k + 'Erro']) { continue; }
      try { el.currentTime = 0; } catch (e) { /* ainda carregando */ }
      try {
        var r = el.play();
        if (r && typeof r.then === 'function') {
          (function (kk) { r.then(function () { som[kk + 'Ok'] = true; }, function () { som[kk + 'Ok'] = false; bipe(); }); })(k);
          return;
        }
        // iOS 9: play() n\u00e3o avisa se tocou; at\u00e9 um dos dois confirmar que toca, o Web Audio toca junto
        if (!som.el2Ok && !som.elOk) { bipe(); }
        return;
      } catch (e2) { som[k + 'Erro'] = -2; }
    }
    bipe();
  }
  function pararSom() {
    try { if (som.el) { som.el.pause(); } } catch (e) { /* nada */ }
    try { if (som.el2) { som.el2.pause(); } } catch (e1) { /* nada */ }
    try { if (voz.ok) { window.speechSynthesis.cancel(); } } catch (e2) { /* nada */ }
    al.falandoAte = 0;
  }

  /* ---------- voz: o iPad fala qual foi o problema ---------- */
  function paraFalar(t) {
    return String(t || '').toLowerCase().replace(/_/g, ' ').replace(/\s+-\s+/g, ', ').replace(/ \u00b7 /g, '. ').replace(/(\d+)x /g, '$1 vezes ').replace(/\bbi\b/g, 'B I');
  }
  function fraseFalada(lista) {
    var p = lista[0], det = String(p.detalhe || ''), corte = det.indexOf(' \u00b7 ');
    if (corte >= 0 && p.modelo) { det = det.substr(corte + 3); }
    var s = 'Aten\u00e7\u00e3o. ' + (lista.length > 1 ? lista.length + ' problemas novos. O primeiro: ' : 'Problema novo: ');
    s += paraFalar(p.nome) + '. ' + (p.valor ? paraFalar(p.valor) + '. ' : '') + paraFalar(det).substr(0, 140);
    return s.substr(0, 320);
  }
  function falar(texto) {
    if (!voz.ok || !voz.ligada) { return false; }
    try {
      var u = new window.SpeechSynthesisUtterance(texto);
      u.lang = 'pt-BR';
      u.rate = 1;
      u.volume = 1;
      u.onend = function () { al.falandoAte = 0; };
      al.falandoAte = agoraMs() + Math.min(25000, 2000 + texto.length * 80);
      // s\u00f3 interrompe se j\u00e1 houver fala em andamento: no Safari, cancelar e falar em seguida pode engolir a frase
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) { window.speechSynthesis.cancel(); }
      window.speechSynthesis.speak(u);
      return true;
    } catch (e) { al.falandoAte = 0; return false; }
  }

  /* ---------- alarme: o que \u00e9 problema novo ---------- */
  function lerVistos() {
    var o = {}, t = agoraMs(), a = null, i, k;
    try { a = JSON.parse(ler(LS_VISTOS) || '{}'); } catch (e) { a = null; }
    if (a && typeof a.length === 'number') { for (i = 0; i < a.length; i++) { o[a[i]] = [t, 0]; } } // formato da vers\u00e3o 1.3
    else if (a) { for (k in a) { if (a.hasOwnProperty(k) && a[k] && a[k].length === 2) { o[k] = a[k]; } } }
    return o;
  }
  function salvarVistos() { gravar(LS_VISTOS, JSON.stringify(al.vistos)); }
  /* Cada item vermelho \u00e9 um problema. A chave vem do PC e identifica o incidente: uma falha que se repete
     a cada meia hora \u00e9 o mesmo incidente e toca uma vez; itens com a mesma causa (ex.: gateway fora) viram um s\u00f3. */
  function problemasAtuais() {
    var lista = [], porChave = {}, d = m.dados, vis = gruposVisiveis(), i, j, k;
    if (!d) { return lista; }
    for (i = 0; i < vis.length; i++) {
      var itens = itensDo(vis[i].id);
      for (j = 0; j < itens.length; j++) {
        var it = itens[j];
        if (!it || it.estado !== 'erro') { continue; }
        var chave = it.raiz || it.chave || (vis[i].id + '|' + (it.nome || '') + '|' + (it.quando || ''));
        var p = { chave: chave, inc: it.inc && !it.raiz ? 1 : 0, grupo: vis[i].nome, nome: it.nome || '', valor: it.valor || '', detalhe: it.detalhe || '', quando: it.quando || '', modelo: !!it.m, junto: 0 };
        var ant = porChave[chave];
        if (!ant) { porChave[chave] = p; lista.push(p); }
        else if (ant.modelo && !p.modelo) {
          // a causa (gateway, banco) vale mais que o modelo que falhou por causa dela
          p.junto = ant.junto + 1;
          porChave[chave] = p;
          for (k = 0; k < lista.length; k++) { if (lista[k] === ant) { lista[k] = p; } }
        } else { ant.junto++; }
      }
    }
    if (dadosVelhos()) {
      var g = quando(d.gerado), semNet = m.rede === 'offline';
      lista.push({
        chave: 'parado|' + d.gerado, inc: 0, grupo: 'MONITOR', junto: 0, quando: d.gerado, modelo: false,
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
  function ehNoite() {
    var h = local(agoraMs()).getHours();
    if (noite.ini === noite.fim) { return false; }
    return noite.ini < noite.fim ? (h >= noite.ini && h < noite.fim) : (h >= noite.ini || h < noite.fim);
  }
  function verificarAlarme() {
    // s\u00f3 depois da primeira busca desta abertura: o \u00faltimo status salvo pode estar velho
    if (!m.dados || m.tentativas === 0 || m.buscando) { return; }
    var atuais = problemasAtuais(), mapa = {}, novos = [], i, k, mudou = false, t = agoraMs();
    for (i = 0; i < atuais.length; i++) { mapa[atuais[i].chave] = atuais[i]; }
    if (!dadosVelhos()) {
      for (k in al.vistos) {
        if (!al.vistos.hasOwnProperty(k) || mapa[k]) { continue; }
        // problema sem data de incidente: quando some, sai da mem\u00f3ria (se voltar, toca de novo).
        // incidente com data: fica 7 dias, para a mesma falha n\u00e3o tocar de novo a cada tentativa
        if (!al.vistos[k][1] || t - al.vistos[k][0] > 7 * 86400000) { delete al.vistos[k]; mudou = true; }
      }
    }
    if (al.ligado && al.base) {
      // acabou de ligar: o que j\u00e1 est\u00e1 vermelho na tela n\u00e3o toca, vale o que aparecer daqui em diante
      for (i = 0; i < atuais.length; i++) { al.vistos[atuais[i].chave] = [t, atuais[i].inc]; }
      al.base = false;
      mudou = true;
    }
    for (i = 0; i < atuais.length; i++) { if (al.vistos[atuais[i].chave]) { al.vistos[atuais[i].chave][0] = t; } }
    if (mudou) { salvarVistos(); }
    if (!al.ligado) { return; }
    if (noite.som && ehNoite()) { return; } // sil\u00eancio da noite: o problema fica para tocar quando o hor\u00e1rio acabar
    for (i = 0; i < atuais.length; i++) { if (!al.vistos[atuais[i].chave] && !naLista(atuais[i].chave)) { novos.push(atuais[i]); } }
    if (novos.length) { dispararAlarme(novos); }
  }
  function dispararAlarme(novos) {
    for (var i = 0; i < novos.length; i++) { al.lista.push(novos[i]); }
    al.tocando = true;
    al.desde = agoraMs();
    al.ultimoSom = al.desde;
    al.ultimaFala = al.desde;
    m.acordadoAte = al.desde + 600000;
    mostrarAlerta();
    renderNoite();
    tocar();
    var frase = fraseFalada(al.lista);
    al.falandoAte = voz.ok && voz.ligada ? al.desde + 12000 : 0; // segura os bipes enquanto a voz n\u00e3o come\u00e7a
    setTimeout(function () { if (al.tocando) { falar(frase); } }, 1500);
  }
  function mostrarAlerta() {
    var n = al.lista.length, s = '', i;
    U.txt('mAlTit', n === 1 ? 'PROBLEMA NOVO' : n + ' PROBLEMAS NOVOS');
    for (i = 0; i < n && i < 4; i++) {
      var p = al.lista[i], t = quando(p.quando);
      s += '<div class="mali"><div class="malg">' + U.esc(p.grupo) + (t !== null ? ' \u00b7 DESDE ' + quandoTxt(t).toUpperCase() : '') + (p.junto ? ' \u00b7 E MAIS ' + p.junto + ' ' + U.plural(p.junto, 'ITEM AFETADO', 'ITENS AFETADOS') : '') + '</div>' +
        '<div class="maln">' + U.esc(p.nome) + (p.valor ? ' \u00b7 ' + U.esc(p.valor) : '') + '</div><div class="mald">' + U.esc(p.detalhe) + '</div></div>';
    }
    if (n > 4) { s += '<div class="mald">+ ' + (n - 4) + ' ' + U.plural(n - 4, 'outro', 'outros') + ' no Monitor</div>'; }
    U.html('mAlLista', s);
    U.txt('mAlQuando', 'Detectado \u00e0s ' + hora(al.desde) + ' \u00b7 o alarme toca at\u00e9 voc\u00ea tocar em Ciente');
    U.classe(U.$('mAlerta'), 'esc', false);
  }
  function ciente() {
    var t = agoraMs();
    for (var i = 0; i < al.lista.length; i++) { al.vistos[al.lista[i].chave] = [t, al.lista[i].inc]; }
    salvarVistos();
    al.lista = [];
    al.tocando = false;
    pararSom();
    U.classe(U.$('mAlerta'), 'esc', true);
  }

  /* ---------- alarme, voz e noite: bot\u00e3o e painel ---------- */
  function renderAlarmeBotao() {
    var dot = U.$('mAlDot');
    if (dot) { dot.style.background = !al.ligado ? COR.off : (som.liberado ? COR.ok : COR.alerta); }
    var dica = '';
    if (m.erroInterno) { dica = 'erro no app (' + m.erroInterno + ')'; }
    else if (al.ligado && !som.liberado) { dica = 'alarme ligado \u00b7 toque na tela para armar o som'; }
    else if (m.novaVersao) { dica = 'vers\u00e3o nova pronta \u00b7 toque em Nova vers\u00e3o para atualizar'; }
    U.txt('mAlDica', dica);
  }
  function hh(h) { return U.pad2(h) + ':00'; }
  function renderAlarmeCfg() {
    U.txt('mAlLigar', al.ligado ? 'Desligar alarme' : 'Ligar alarme');
    U.classe(U.$('mAlLigar'), 'pri', !al.ligado);
    U.txt('mAlEstado', al.ligado ? (som.liberado ? 'Alarme LIGADO \u00b7 som armado' : 'Alarme LIGADO \u00b7 toque na tela para armar o som') : 'Alarme DESLIGADO');
    U.txt('mAlVoz', !voz.ok ? 'Voz: este iPad n\u00e3o tem' : (voz.ligada ? 'Voz: ligada' : 'Voz: desligada'));
    U.classe(U.$('mAlVoz'), 'off', !voz.ok);
    U.classe(U.$('mAlVoz'), 'pri', voz.ok && voz.ligada);
    U.txt('mNoiteIni', hh(noite.ini));
    U.txt('mNoiteFim', hh(noite.fim));
    U.txt('mNoiteTela', noite.tela ? 'Tela escura: ligada' : 'Tela escura: desligada');
    U.classe(U.$('mNoiteTela'), 'pri', noite.tela);
    U.txt('mNoiteSom', noite.som ? 'Sem som \u00e0 noite: ligado' : 'Sem som \u00e0 noite: desligado');
    U.classe(U.$('mNoiteSom'), 'pri', noite.som);
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
  /* Testar som (1.8.1): toca o alarme de quatro jeitos, um de cada vez, e diz na tela o que o iPad conseguiu tocar.
     Se tudo tocou e n\u00e3o se ouviu nada, o problema \u00e9 o volume ou a sa\u00edda de som do iPad, n\u00e3o o app. */
  var diag = null;
  var NOME_DIAG = { voz: 'Voz', arq: 'Arquivo do site', app: 'Som do app', bipe: 'Bipe' };
  function msgDiag(t) { U.txt('mAlMsg', t); }
  function testarVoz(d, fim) {
    var feito = false;
    function acabar(r) { if (feito) { return; } feito = true; if (r && !d.r.voz) { d.r.voz = r; } setTimeout(fim, 300); }
    if (!voz.ok) { d.r.voz = 'este iPad n\u00e3o tem'; fim(); return; }
    try {
      var u = new window.SpeechSynthesisUtterance('Teste do alarme. \u00c9 assim que eu aviso quando aparecer um problema.');
      u.lang = 'pt-BR'; u.rate = 1; u.volume = 1;
      u.onstart = function () { d.r.voz = 'ok'; };
      u.onend = function () { acabar(d.r.voz ? '' : 'ok'); };
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) { window.speechSynthesis.cancel(); }
      window.speechSynthesis.speak(u);
    } catch (e) { acabar('erro'); return; }
    setTimeout(function () { try { window.speechSynthesis.cancel(); } catch (e2) { /* nada */ } acabar('n\u00e3o come\u00e7ou'); }, 7000);
  }
  function testarEl(d, el, k, ms, fim) {
    if (!el) { d.r[k] = 'n\u00e3o existe'; fim(); return; }
    var tu = 0, tocou = false, erro = 0;
    var aoTocar = function () { tocou = true; }, aoAndar = function () { tu++; }, aoErro = function () { erro = (el.error && el.error.code) || -1; };
    el.addEventListener('playing', aoTocar, false); el.addEventListener('timeupdate', aoAndar, false); el.addEventListener('error', aoErro, false);
    try { el.loop = true; } catch (e) { /* nada */ }
    try { el.currentTime = 0; } catch (e1) { /* ainda carregando */ }
    try {
      var p = el.play();
      if (p && typeof p.then === 'function') { p.then(null, function () { if (!erro) { erro = -3; } }); }
    } catch (e2) { erro = -2; }
    setTimeout(function () {
      try { el.pause(); el.loop = false; } catch (e3) { /* nada */ }
      el.removeEventListener('playing', aoTocar, false); el.removeEventListener('timeupdate', aoAndar, false); el.removeEventListener('error', aoErro, false);
      d.r[k] = erro ? 'erro ' + erro : (tocou && tu >= 2 ? 'ok' : (tocou ? 'parou' : 'n\u00e3o come\u00e7ou'));
      if (d.r[k] === 'ok') { som[k === 'arq' ? 'elOk' : 'el2Ok'] = true; }
      fim();
    }, ms);
  }
  function testarBipe(d, fim) {
    var ac = som.ac;
    if (!ac) { d.r.bipe = 'sem Web Audio'; fim(); return; }
    var t1 = ac.currentTime;
    bipe();
    setTimeout(function () { d.r.bipe = ac.currentTime - t1 > 0.5 ? 'ok' : 'parado' + (ac.state ? ' (' + ac.state + ')' : ''); fim(); }, 1500);
  }
  function resultadoDiag(d) {
    var ks = ['voz', 'arq', 'app', 'bipe'], l = [], bons = 0, i;
    for (i = 0; i < ks.length; i++) {
      var r = d.r[ks[i]] || '?';
      if (r === 'ok') { bons++; }
      l.push(NOME_DIAG[ks[i]] + (r === 'ok' ? ' \u2713' : ' \u2717 ' + r));
    }
    var txt = l.join(' \u00b7 ') + '. ';
    if (bons === ks.length) { txt += 'O iPad tocou tudo. Se voc\u00ea n\u00e3o ouviu, o som dele est\u00e1 mudo ou saindo por outro lugar: veja a Central de Controle (volume, sininho, Bluetooth) e se aparece um fone ao apertar o volume.'; }
    else if (bons) { txt += 'O alarme passa a usar o que tocou. Se n\u00e3o ouviu nem esses, o som do iPad est\u00e1 mudo ou saindo por outro lugar.'; }
    else { txt += 'Nenhum jeito tocou: me mande esta linha.'; }
    msgDiag(txt);
    diag = null;
    renderAlarmeBotao();
  }
  function testarSom() {
    if (diag) { return; } // j\u00e1 est\u00e1 testando
    prepararSom(true);
    // prepara os dois sons dentro do toque: depois eles tocam sozinhos, como no alarme de verdade
    try { if (som.el) { som.el.load(); } } catch (e) { /* nada */ }
    try { if (som.el2) { som.el2.load(); } } catch (e1) { /* nada */ }
    var d = diag = { r: {} };
    msgDiag('Teste 1 de 4: voz\u2026');
    testarVoz(d, function () {
      msgDiag('Teste 2 de 4: o arquivo do alarme, que vem do site\u2026 (d\u00e1 tempo de apertar o volume para cima)');
      testarEl(d, som.el, 'arq', 3000, function () {
        msgDiag('Teste 3 de 4: o som guardado no pr\u00f3prio app\u2026');
        testarEl(d, som.el2, 'app', 2500, function () {
          msgDiag('Teste 4 de 4: o bipe gerado na hora\u2026');
          testarBipe(d, function () { resultadoDiag(d); });
        });
      });
    });
    renderAlarmeCfg();
    renderAlarmeBotao();
  }
  function alternarVoz() {
    if (!voz.ok) { U.txt('mAlMsg', 'O Safari deste iPad n\u00e3o oferece voz para o app. O alarme toca normalmente.'); return; }
    voz.ligada = !voz.ligada;
    gravar(LS_VOZ, voz.ligada ? '1' : '0');
    prepararSom(true);
    if (voz.ligada) { falar('Voz ligada.'); }
    U.txt('mAlMsg', voz.ligada ? 'Quando o alarme tocar, o iPad fala qual foi o problema.' : 'O alarme toca sem falar.');
    renderAlarmeCfg();
  }
  function salvarNoite() { gravar(LS_NOITE, JSON.stringify(noite)); }
  function mudarNoite(arg) {
    if (arg === 'ini') { noite.ini = (noite.ini + 1) % 24; }
    else if (arg === 'fim') { noite.fim = (noite.fim + 1) % 24; }
    else if (arg === 'tela') { noite.tela = !noite.tela; m.acordadoAte = agoraMs() + 120000; }
    else if (arg === 'som') { noite.som = !noite.som; }
    salvarNoite();
    U.txt('mAlMsg', arg === 'som' && noite.som ? 'Das ' + hh(noite.ini) + ' \u00e0s ' + hh(noite.fim) + ' o alarme espera. Se o problema continuar, toca quando o hor\u00e1rio acabar.' :
      (arg === 'tela' && noite.tela ? 'Das ' + hh(noite.ini) + ' \u00e0s ' + hh(noite.fim) + ' a tela fica escura. Ela acende ao toque e quando o alarme dispara.' : ''));
    renderAlarmeCfg();
    renderNoite();
  }
  /* tela escura da noite: cobre tudo, mostra s\u00f3 a hora e uma linha de estado; acende ao toque ou com o alarme */
  function renderNoite() {
    var el = U.$('mNoite');
    if (!el) { return; }
    var t = agoraMs(), on = noite.tela && ehNoite() && !al.tocando && t > m.acordadoAte && !!m.chave;
    U.classe(el, 'esc', !on);
    U.classe(document.body, 'noite', on);
    m.noiteOn = on;
    if (!on) { return; }
    var e = estadoGeral(), txt;
    if (!m.dados) { txt = 'sem dados'; }
    else if (e.velho) { txt = 'sem receber dados do PC'; }
    else if (e.c.erro) { txt = e.c.erro + ' ' + U.plural(e.c.erro, 'problema', 'problemas'); }
    else if (e.c.alerta) { txt = e.c.alerta + ' ' + U.plural(e.c.alerta, 'ponto de aten\u00e7\u00e3o', 'pontos de aten\u00e7\u00e3o'); }
    else { txt = 'tudo certo'; }
    U.txt('mNoiteHora', hora(t));
    U.txt('mNoiteTxt', txt + (al.ligado ? (noite.som ? ' \u00b7 alarme em sil\u00eancio at\u00e9 ' + hh(noite.fim) : ' \u00b7 alarme ligado') : ' \u00b7 alarme desligado'));
    U.$('mNoiteDot').style.background = COR[e.cor];
  }

  /* ---------- vers\u00e3o nova do app ----------
     Recarregar a p\u00e1gina desarma o som (o iOS pede um toque de novo). Por isso, com o alarme armado,
     a vers\u00e3o nova espera um toque no bot\u00e3o; sem alarme, entra sozinha. */
  function versaoPronta() {
    try { window.applicationCache.swapCache(); } catch (e) { /* nada */ }
    if (al.ligado && som.liberado) { m.novaVersao = true; render(); return; }
    window.location.reload();
  }
  function procurarVersao() {
    try { if (window.applicationCache && navigator.onLine !== false) { window.applicationCache.update(); } } catch (e) { /* ainda sem cache */ }
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
  function falarDepois(frase) {
    setTimeout(function () { if (al.tocando) { falar(frase); } }, 1500);
  }
  function tick() {
    var t = agoraMs();
    if (!m.buscando && t >= m.proxima && document.hidden !== true) { buscar(false); }
    if (t - m.ultimoRender > 30000) { render(); }
    if (t >= m.proximaVersao) { m.proximaVersao = t + 1800000; procurarVersao(); }
    if (m.chave && m.dados && (dadosVelhos() || m.rede === 'offline')) { verGithub(); }
    if (volta.ate && t > volta.ate) { volta.ate = 0; renderHero(); }
    if (m.noiteOn) { U.txt('mNoiteHora', hora(t)); }
    else if (noite.tela && t > m.acordadoAte && t - m.ultimoRender > 5000 && ehNoite() && !al.tocando) { seguro('noite', renderNoite); } // apaga logo que os 2 minutos passam
    if (al.tocando && document.hidden !== true && t >= al.falandoAte) {
      var forte = t - al.desde < ALARME_FORTE;
      if (t - al.ultimoSom >= (forte ? REPETE_FORTE : REPETE_FRACO)) {
        al.ultimoSom = t;
        tocar();
        if (voz.ok && voz.ligada && (!forte || t - al.ultimaFala >= REPETE_FALA)) {
          al.ultimaFala = t;
          al.falandoAte = t + 12000;
          falarDepois(fraseFalada(al.lista));
        }
      }
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
      voz.ok = !!(window.speechSynthesis && window.SpeechSynthesisUtterance);
      voz.ligada = ler(LS_VOZ) !== '0';
      try {
        var n = JSON.parse(ler(LS_NOITE) || 'null');
        if (n) { noite.tela = !!n.tela; noite.som = !!n.som; if (n.ini >= 0 && n.ini < 24) { noite.ini = n.ini; } if (n.fim >= 0 && n.fim < 24) { noite.fim = n.fim; } }
      } catch (e2) { /* fica o padr\u00e3o */ }
      m.proximaVersao = agoraMs() + 1800000;
      lerSil();
      voltou();
      U.acoes['mon-atualizar'] = function () { if (m.novaVersao) { window.location.reload(); return; } m.proxima = 0; buscar(true); };
      U.acoes['mon-chave'] = function () { mostrarSetup(true); };
      U.acoes['mon-salvar'] = salvarChave;
      U.acoes['mon-cancelar'] = function () { if (m.chave) { mostrarSetup(false); } };
      U.acoes['mon-grupo'] = function (id) { abrirDetalhe(id); };
      U.acoes['mon-fechar'] = fecharDetalhe;
      U.acoes['mon-pag'] = function (d) { m.pag += parseInt(d, 10) || 0; renderDetalhe(); };
      U.acoes['mon-modelo'] = function (i) { abrirFicha(i); };
      U.acoes['mon-item'] = function (i) { abrirItem(i); };
      U.acoes['mon-mapa'] = abrirMapa;
      U.acoes['mon-mapa-modelo'] = function (id) { abrirModeloId(id); };
      U.acoes['mon-abrir'] = function (chave) { abrirItemChave(chave); };
      U.acoes['mon-abrir-modelo'] = function (id) { abrirModeloDireto(id); };
      U.acoes['mon-robo'] = function (id) { abrirRobo(id); };
      U.acoes['mon-ficha-alt'] = function () { if (m.fichaTipo === 'mapa') { m.mapa7 = !m.mapa7; renderFicha(); } };
      U.acoes['mon-sil'] = function (dias) {
        if ((m.fichaTipo !== 'item' && m.fichaTipo !== 'robo') || !m.fichaItem) { return; }
        silenciar(itemAtual(m.fichaItem), parseInt(dias, 10) || 0);
        render();
      };
      U.acoes['mon-ficha-fechar'] = voltarFicha;
      U.acoes['mon-alarme'] = function () { mostrarAlarmeCfg(true); };
      U.acoes['mon-al-ligar'] = alternarAlarme;
      U.acoes['mon-al-testar'] = testarSom;
      U.acoes['mon-al-voz'] = alternarVoz;
      U.acoes['mon-noite'] = mudarNoite;
      U.acoes['mon-noite-acordar'] = function () { m.acordadoAte = agoraMs() + 120000; renderNoite(); };
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
      // qualquer toque: arma o som (exig\u00eancia do iOS) e mant\u00e9m a tela acesa por 2 minutos no hor\u00e1rio da noite
      var toque = function () {
        seguro('volta', voltou);
        if (al.ligado && !som.liberado) { prepararSom(false); renderAlarmeBotao(); renderAlarmeCfg(); }
        if (noite.tela) { var t = agoraMs() + 120000; if (t > m.acordadoAte) { m.acordadoAte = t; } }
      };
      document.addEventListener('touchend', toque, false);
      document.addEventListener('mousedown', toque, false);
      if (!m.chave) { mostrarSetup(true); }
      document.addEventListener('visibilitychange', function () { if (!document.hidden) { m.proxima = 0; seguro('volta', voltou); } }, false);
      if (window.applicationCache) {
        window.applicationCache.addEventListener('updateready', versaoPronta, false);
      }
      render();
      buscar(false);
    },
    render: render,
    tick: tick
  });
})();
