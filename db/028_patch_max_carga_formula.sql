-- Capacidade máxima de carga deixa de ser um número que o player edita
-- livremente e vira uma fórmula: 3x Força + um adicional que só o
-- mestre define (ex: 30 de base com Força 10, +10 adicional = 40).
-- max_carga continua existindo (o bot do Discord lê essa coluna
-- direto) -- character.js passa a recalculá-la a partir da fórmula
-- toda vez que salva, em vez de aceitar o valor bruto digitado.
alter table characters add column if not exists max_carga_bonus numeric not null default 0;

-- preserva a capacidade efetiva de quem já tinha um max_carga
-- customizado antes de a fórmula existir (não faz ninguém perder
-- carga de uma hora pra outra por causa dessa mudança).
update characters
set max_carga_bonus = greatest(0, coalesce(max_carga, 60) - 3 * coalesce(forca, 10))
where max_carga_bonus = 0;
