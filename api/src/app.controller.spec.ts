import { AppController } from './app.controller';

describe('AppController', () => {
  const controller = new AppController();

  afterEach(() => {
    delete process.env.PUBLIC_ORIGIN;
  });

  it('повертає null, якщо публічну адресу не задано', () => {
    expect(controller.config()).toEqual({ publicOrigin: null });
  });

  it('обрізає зайвий слеш у публічній адресі', () => {
    process.env.PUBLIC_ORIGIN = 'https://digicomp.example/';
    expect(controller.config()).toEqual({
      publicOrigin: 'https://digicomp.example',
    });
  });
});
