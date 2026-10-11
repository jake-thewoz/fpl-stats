import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_COLUMNS } from './fields';
import { insertAtDefaultPositions, loadColumns, saveColumns } from './storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('insertAtDefaultPositions', () => {
  it('places a new column after its default predecessor', () => {
    expect(insertAtDefaultPositions(['xp', 'form', 'price'], ['fixtures'])).toEqual([
      'xp',
      'fixtures',
      'form',
      'price',
    ]);
  });

  it('puts it first when no predecessor is shown', () => {
    expect(insertAtDefaultPositions(['price'], ['fixtures'])).toEqual([
      'fixtures',
      'price',
    ]);
  });
});

describe('loadColumns', () => {
  it('gives a fresh install the defaults', async () => {
    expect(await loadColumns()).toEqual(DEFAULT_COLUMNS);
  });

  it('adds an introduced column to saved columns once', async () => {
    await saveColumns(['xp', 'price']);
    expect(await loadColumns()).toEqual(['xp', 'fixtures', 'price']);

    await saveColumns(['xp', 'price']);
    expect(await loadColumns()).toEqual(['xp', 'price']);
  });

  it("doesn't re-add a column a fresh install later removes", async () => {
    await loadColumns();
    await saveColumns(['xp']);
    expect(await loadColumns()).toEqual(['xp']);
  });
});
