import { applyFontRole, fontRole, resolveFontFace } from './typography';

describe('resolveFontFace', () => {
  it('defaults to the regular body face', () => {
    expect(resolveFontFace()).toBe('Rubik_400Regular');
  });

  it('returns the exact face when it is loaded', () => {
    expect(resolveFontFace('body', 600)).toBe('Rubik_600SemiBold');
    expect(resolveFontFace('display', 800)).toBe('Sora_800ExtraBold');
  });

  it('picks the nearest loaded face, heavier on a tie', () => {
    expect(resolveFontFace('numeric', 400)).toBe('Sora_600SemiBold');
    expect(resolveFontFace('body', 900)).toBe('Rubik_700Bold');
    expect(resolveFontFace('numeric', 650)).toBe('Sora_700Bold');
  });
});

describe('applyFontRole', () => {
  it('gives unstyled text the body face and no fontWeight', () => {
    const { style, font } = applyFontRole({ color: 'red' }, null, true);
    expect(style).toEqual({ color: 'red', fontFamily: 'Rubik_400Regular' });
    expect(font).toEqual({ role: 'body', weight: 400 });
  });

  it('resolves a role plus weight to one face', () => {
    const { style } = applyFontRole(
      { ...fontRole.numeric, fontWeight: '700' },
      null,
      true,
    );
    expect(style).toEqual({ fontFamily: 'Sora_700Bold', fontVariant: ['tabular-nums'] });
  });

  it('reads named weights', () => {
    expect(applyFontRole({ fontWeight: 'bold' }, null, true).style.fontFamily).toBe(
      'Rubik_700Bold',
    );
  });

  it('inherits role and weight from the parent Text', () => {
    const parent = applyFontRole({ ...fontRole.display }, null, true).font;
    expect(applyFontRole({}, parent, true).style.fontFamily).toBe('Sora_800ExtraBold');
    expect(applyFontRole({ fontWeight: '600' }, parent, true).style.fontFamily).toBe(
      'Sora_600SemiBold',
    );
  });

  it('leaves a real font family alone', () => {
    const style = { fontFamily: 'monospace', fontWeight: '600' as const };
    expect(applyFontRole(style, null, true).style).toBe(style);
  });

  it('falls back to the system font at the intended weight when fonts failed', () => {
    expect(
      applyFontRole({ ...fontRole.numeric, fontWeight: '700' }, null, false).style,
    ).toEqual({
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    });
    expect(applyFontRole({ color: 'red' }, null, false).style).toEqual({ color: 'red' });
  });
});
