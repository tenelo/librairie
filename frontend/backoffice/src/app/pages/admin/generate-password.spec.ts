import { generatePassword } from './user-dialog.component';

describe('mot de passe généré à la création d’un utilisateur', () => {
  it('est simple : un mot, un tiret et 4 chiffres (au moins 8 caractères)', () => {
    for (let i = 0; i < 50; i++) {
      const password = generatePassword();
      expect(password).toMatch(/^[A-Z][a-z]+-\d{4}$/);
      expect(password.length).toBeGreaterThanOrEqual(8);
    }
  });

  it('change à chaque tirage', () => {
    const passwords = new Set(Array.from({ length: 20 }, () => generatePassword()));
    expect(passwords.size).toBeGreaterThan(1);
  });
});
