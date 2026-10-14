// Creatures CLIP can name. Used to label each crop ("Your cat is a fox") and, through their text
// embeddings, to find the directions that separate species so matching can ignore them.
export const CREATURES = [
  'cat', 'lion', 'tiger', 'leopard', 'lynx', 'dog', 'wolf', 'fox', 'bear', 'raccoon',
  'horse', 'donkey', 'cow', 'bull', 'sheep', 'goat', 'pig', 'deer', 'rabbit', 'hare',
  'squirrel', 'mouse', 'rat', 'hedgehog', 'badger', 'otter', 'weasel', 'monkey', 'elephant', 'camel',
  'bat', 'seal', 'owl', 'eagle', 'hawk', 'parrot', 'peacock', 'swan', 'duck', 'goose',
  'rooster', 'hen', 'pigeon', 'crow', 'songbird', 'heron', 'pelican', 'flamingo', 'fish', 'frog',
  'turtle', 'snake', 'lizard', 'crocodile', 'dragon', 'griffin', 'unicorn', 'butterfly', 'beetle', 'bee',
] as const;

export const creaturePrompt = (c: string) => `a painting of a ${c}`;
