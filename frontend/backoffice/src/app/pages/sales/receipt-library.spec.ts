import { receiptLibrary } from './pos.service';

describe('reçu propre à chaque librairie', () => {
  const settings = {
    name: 'ETS MASSA', logo: '/media/settings/logo.png', address: 'Siège', city: 'Abidjan', phone: '0101010101',
    email: 'contact@massa.ci', taxpayer_number: 'CC-123', trade_register: 'RCCM-1', receipt_header: '',
    receipt_footer: 'Merci de votre visite !',
  };

  it('reprend les paramètres généraux sans librairie', () => {
    const r = receiptLibrary(settings, null);
    expect(r.name).toBe('ETS MASSA');
    expect(r.city).toBe('Abidjan');
    expect(r.receipt_footer).toBe('Merci de votre visite !');
  });

  it('applique les champs remplis de la librairie et garde les autres des paramètres', () => {
    const r = receiptLibrary(settings, { receipt_name: '', city: 'Ferkessédougou', phone: '0707070707',
      receipt_footer: 'Merci, à bientôt à Ferké !', address: '' });
    expect(r.name).toBe('ETS MASSA');
    expect(r.city).toBe('Ferkessédougou');
    expect(r.phone).toBe('0707070707');
    expect(r.address).toBe('Siège');
    expect(r.taxpayer_number).toBe('CC-123');
    expect(r.receipt_footer).toBe('Merci, à bientôt à Ferké !');
    expect(r.logo).toBe('/media/settings/logo.png');
  });

  it('prend le nom sur le reçu de la librairie quand il est rempli', () => {
    expect(receiptLibrary(settings, { receipt_name: 'ETS MASSA — Ferké' }).name).toBe('ETS MASSA — Ferké');
  });
});
