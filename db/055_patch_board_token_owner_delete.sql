-- Tabuleiro: dono do personagem também pode TIRAR o próprio token do
-- tabuleiro (antes só dava pra mover, ver db/054 -- a policy "token:
-- dono ajusta o próprio" só cobre UPDATE). Pedido do usuário: dar a
-- opção de remover token. Mantém o resto do modelo de permissão como
-- já decidido -- só o MESTRE cria/coloca token (a policy de INSERT
-- continua restrita a is_master()); isso aqui só abre DELETE pro
-- dono do personagem vinculado, igual já valia pra UPDATE.
create policy "token: dono remove o próprio" on board_tokens
  for delete using (character_id in (select id from characters where owner_id = auth.uid()));
