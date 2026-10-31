-- Tabuleiro: só o MESTRE tira token (e só o mestre coloca). A db/055 tinha aberto DELETE pro dono do personagem
-- ("token: dono remove o próprio"); pedido do mestre: jogador não remove mais token, nem pela tela nem direto na API.
-- Apaga toda policy de DELETE de board_tokens que seja do dono (pelo nome original ou por uma cópia gerada pela RLS v2);
-- a policy do mestre ("token: mestre mexe", for all) continua valendo.
do $$
declare
  r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'board_tokens' and cmd = 'DELETE'
      and (policyname ilike '%dono remove%' or qual ilike '%owner_id%')
  loop
    execute format('drop policy %I on board_tokens', r.policyname);
  end loop;
end $$;
