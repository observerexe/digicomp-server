import { splitPoints } from './split-points';

describe('splitPoints', () => {
  it('ділить порівну без остачі', () => {
    expect(splitPoints(9, ['a', 'b', 'c']).map((s) => s.amount)).toEqual([
      3, 3, 3,
    ]);
  });

  it('10 на 3: зайвий бал тому, хто взяв першим', () => {
    expect(splitPoints(10, ['a', 'b', 'c'])).toEqual([
      { assignee: 'a', amount: 4 },
      { assignee: 'b', amount: 3 },
      { assignee: 'c', amount: 3 },
    ]);
  });

  it('остача 2: по одному балу двом першим', () => {
    expect(splitPoints(11, ['a', 'b', 'c']).map((s) => s.amount)).toEqual([
      4, 4, 3,
    ]);
  });

  it('один виконавець отримує все', () => {
    expect(splitPoints(7, ['a'])).toEqual([{ assignee: 'a', amount: 7 }]);
  });

  it('балів менше, ніж виконавців: нульові частки не записуються', () => {
    expect(splitPoints(2, ['a', 'b', 'c'])).toEqual([
      { assignee: 'a', amount: 1 },
      { assignee: 'b', amount: 1 },
    ]);
  });

  it('0 балів або немає виконавців — нічого', () => {
    expect(splitPoints(0, ['a', 'b'])).toEqual([]);
    expect(splitPoints(5, [])).toEqual([]);
  });

  it('сума часток дорівнює загальній', () => {
    for (let total = 1; total <= 50; total++) {
      for (let n = 1; n <= 7; n++) {
        const parts = splitPoints(
          total,
          Array.from({ length: n }, (_, i) => i),
        );
        expect(parts.reduce((s, p) => s + p.amount, 0)).toBe(total);
      }
    }
  });
});
