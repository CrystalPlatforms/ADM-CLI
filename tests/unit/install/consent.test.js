const {
  MANAGER_PROVIDERS,
  METHOD_MANAGERS,
  decideManager,
  createConsentSession,
  orderByDependencies,
} = require('../../../src/install/consent');

// #44 AC: "Test macierzowy silnika: zaznaczony→auto; niezaznaczony+
// interaktywny→pytanie; drugie narzędzie tego samego menedżera→bez drugiego
// pytania; odmowa→✗+podpowiedź; nieinteraktywny→✗, pozostałe nietknięte".

describe('decideManager — pure decision matrix (#44)', () => {
  test('selected (consented) → auto-approved, no question', () => {
    const d = decideManager({ manager: 'npm', toolName: 'yarn', consented: true, asked: false, interactive: true });
    expect(d).toEqual({ action: 'approved' });
  });

  test('not selected + interactive → ask with the PRD message shape', () => {
    const d = decideManager({ manager: 'npm', toolName: 'yarn', consented: false, asked: false, interactive: true });
    expect(d.action).toBe('ask');
    expect(d.message).toBe('yarn requires npm (Node.js) — install it?');
  });

  test('already asked (declined earlier) → skip with reason + hint', () => {
    const d = decideManager({ manager: 'npm', toolName: 'yarn', consented: false, asked: true, interactive: true });
    expect(d.action).toBe('skip');
    expect(d.reason).toContain('declined');
    expect(d.hint).toContain('ADM_TOOLS=node adm');
  });

  test('non-interactive → skip with reason + hint, nothing asked', () => {
    const d = decideManager({ manager: 'npm', toolName: 'yarn', consented: false, asked: false, interactive: false });
    expect(d.action).toBe('skip');
    expect(d.reason).toBe('requires npm (Node.js), which is not installed');
    expect(d.hint).toContain('ADM_TOOLS=node adm');
  });

  test('every ecosystem manager maps to its provisioning catalog tool', () => {
    expect(MANAGER_PROVIDERS.npm.tool).toBe('node');
    expect(MANAGER_PROVIDERS.pip.tool).toBe('python3');
    expect(MANAGER_PROVIDERS.cargo.tool).toBe('rustup');
    expect(MANAGER_PROVIDERS.go.tool).toBe('go');
    expect(MANAGER_PROVIDERS.gem.tool).toBe('ruby');
    expect(MANAGER_PROVIDERS.composer.tool).toBe('composer');
    expect(MANAGER_PROVIDERS.dotnet.tool).toBe('dotnet');
    expect(MANAGER_PROVIDERS.brew.tool).toBe('homebrew');
  });

  test('install methods that depend on a manager are keyed (depth 1)', () => {
    expect(METHOD_MANAGERS.npm).toBe('npm');
    expect(METHOD_MANAGERS.node).toBe('npm');
    expect(METHOD_MANAGERS.pip).toBe('pip');
    expect(METHOD_MANAGERS.python).toBe('pip');
    expect(METHOD_MANAGERS.cargo).toBe('cargo');
    expect(METHOD_MANAGERS.go).toBe('go');
    expect(METHOD_MANAGERS.gem).toBe('gem');
    expect(METHOD_MANAGERS.composer).toBe('composer');
    expect(METHOD_MANAGERS.dotnet).toBe('dotnet');
    // self-contained routes: no manager dependency
    expect(METHOD_MANAGERS.nvm).toBeUndefined();
    expect(METHOD_MANAGERS.script).toBeUndefined();
    expect(METHOD_MANAGERS.rustup).toBeUndefined();
    expect(METHOD_MANAGERS.brew).toBeUndefined();
  });
});

describe('createConsentSession — one question per manager per run', () => {
  test('provider marked in the wizard = consent up-front: NO confirm call', async () => {
    const confirms = [];
    const session = createConsentSession({
      interactive: true,
      consentedManagers: ['npm'],
      confirm: async m => { confirms.push(m); return true; },
    });
    const d = await session.resolve('yarn', 'npm');
    expect(d.action).toBe('approved');
    expect(confirms).toHaveLength(0);
  });

  test('not marked + interactive → ONE question; answer yes consents the run', async () => {
    const confirms = [];
    const session = createConsentSession({
      interactive: true,
      confirm: async m => { confirms.push(m); return true; },
    });
    const first = await session.resolve('yarn', 'npm');
    expect(first.action).toBe('approved');
    expect(confirms).toHaveLength(1);
    expect(confirms[0]).toContain('yarn requires npm (Node.js)');

    // a SECOND tool needing the same manager: no second question
    const second = await session.resolve('typescript', 'npm');
    expect(second.action).toBe('approved');
    expect(confirms).toHaveLength(1);
  });

  test('declined → skip with reason + hint; the same manager is not asked twice', async () => {
    const confirms = [];
    const session = createConsentSession({
      interactive: true,
      confirm: async m => { confirms.push(m); return false; },
    });
    const yarn = await session.resolve('yarn', 'npm');
    expect(yarn.action).toBe('skip');
    expect(yarn.reason).toContain('declined');
    expect(yarn.hint).toContain('ADM_TOOLS=node adm');

    const typescript = await session.resolve('typescript', 'npm');
    expect(typescript.action).toBe('skip');
    expect(confirms).toHaveLength(1); // still exactly one question
  });

  test('different managers are asked independently', async () => {
    const confirms = [];
    const session = createConsentSession({
      interactive: true,
      confirm: async m => { confirms.push(m); return true; },
    });
    await session.resolve('yarn', 'npm');
    await session.resolve('poetry', 'pip');
    expect(confirms).toHaveLength(2);
    expect(confirms[1]).toContain('poetry requires pip (Python)');
  });

  test('non-interactive session never confirms', async () => {
    const confirms = [];
    const session = createConsentSession({
      interactive: false,
      confirm: async m => { confirms.push(m); return true; },
    });
    const d = await session.resolve('yarn', 'npm');
    expect(d.action).toBe('skip');
    expect(confirms).toHaveLength(0);
  });

  test('consents live ONLY in memory — no persistence API, no disk trace', async () => {
    // The session exposes the run's consents for the report only; there is
    // no write path. Assert the surface stays memory-shaped.
    const session = createConsentSession({ interactive: true, confirm: async () => true });
    await session.resolve('yarn', 'npm');
    expect(session.consents).toEqual(['npm']);
    // a fresh run starts clean
    const next = createConsentSession({ interactive: true, confirm: async () => true });
    expect(next.consents).toEqual([]);
  });
});

describe('orderByDependencies — manager before dependents (#44)', () => {
  test('Node precedes yarn/typescript while the pick order within a depth stands', () => {
    const entries = [
      { id: 'yarn', method: 'npm' },
      { id: 'node', method: 'nvm' },
      { id: 'typescript', method: 'npm' },
      { id: 'git', method: 'brew' },
      { id: 'bun', method: 'script' },
    ];
    orderByDependencies(entries);
    expect(entries.map(e => e.id)).toEqual(['node', 'git', 'bun', 'yarn', 'typescript']);
  });

  test('already-correct order is untouched', () => {
    const entries = [{ id: 'rustup', method: 'script' }, { id: 'rust-analyzer', method: 'cargo' }];
    orderByDependencies(entries);
    expect(entries.map(e => e.id)).toEqual(['rustup', 'rust-analyzer']);
  });
});
