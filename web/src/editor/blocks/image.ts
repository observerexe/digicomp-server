import type { ImageBlock } from '.';

/** «Зображення»: the file is picked when the block is put (a logo of a template, a scheme). */
export const image: ImageBlock = {
  key: 'image',
  group: 'text',
  kind: 'image',
  label: 'Зображення',
  icon: 'image',
  words: ['картинка', 'фото', 'логотип'],
};
