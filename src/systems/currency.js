// Dinheiro por sistema de regras. Cada ruleset declara `currency`:
//   { mode: 'coins',  units: [{ key, short, label }], ratio }  -- moedas em cascata (cada unidade vale `ratio` da anterior)
//   { mode: 'single', label }                                    -- dinheiro normal, um valor só
// Armazenamento: characters.currency continua no formato das 4 moedas (bronze/silver/gold/platinum), que é a "unidade" do
// banco e da RPC transfer_currency; o modo 'single' lê/grava o TOTAL nessa mesma estrutura (nada muda no banco).
// A Edge Function do Discord (supabase/functions/_shared/format.ts) tem o espelho desta tabela: ao criar um sistema com
// moeda diferente, atualizar os dois.
export const COIN_CURRENCY = {
  mode: 'coins',
  ratio: 100,
  units: [
    { key: 'bronze', short: 'b', label: 'bronze' },
    { key: 'silver', short: 's', label: 'prata' },
    { key: 'gold', short: 'o', label: 'ouro' },
    { key: 'platinum', short: 'p', label: 'platina' },
  ],
};
export const SINGLE_CURRENCY = { mode: 'single', label: 'Dinheiro' };
