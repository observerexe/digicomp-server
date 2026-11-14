import { slugify, uniqueKey } from './keys';

describe('Ключі довідників', () => {
  it.each([
    ['Тип ТЗ', 'typ_tz'],
    ['Категорія архіву', 'katehoriia_arkhivu'],
    ['Яскравість', 'yaskravist'],
    ['Їжак і йод', 'yizhak_i_yod'],
    ["Об'єкт", 'obiekt'],
    ['Згода', 'zghoda'],
    ['3D-друк', 'k_3d_druk'],
    ['Video & Photo', 'video_photo'],
    ['🙂', 'k'],
  ])('%s → %s', (title, key) => {
    expect(slugify(title)).toBe(key);
  });

  it('лише латиниця, цифри й _, починається з літери, до 40 символів', () => {
    const key = slugify('Дуже довга назва довідника, що не влазить у ключ');
    expect(key).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
    expect(key.endsWith('_')).toBe(false);
  });

  it('зайнятий ключ отримує номер', () => {
    expect(uniqueKey('Тип', [])).toBe('typ');
    expect(uniqueKey('Тип', ['typ'])).toBe('typ_2');
    expect(uniqueKey('Тип', ['typ', 'typ_2'])).toBe('typ_3');
  });

  it('номер не виводить ключ за 40 символів', () => {
    const long = 'a'.repeat(40);
    expect(uniqueKey(long, [long])).toBe('a'.repeat(38) + '_2');
  });
});
