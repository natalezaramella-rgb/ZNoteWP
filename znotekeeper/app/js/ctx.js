// Contesto condiviso tra i moduli dell'interfaccia (riempito da main.js).
export const app = {
  R: { view: 'notes', section: null, page: null, list: null, task: null, from: null },
  readonly: false,
  desk: false,
  go: () => {},
  render: () => {},
  lock: () => {},
};
