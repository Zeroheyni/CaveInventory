-- Bug: combat_participants.avatar_url só era preenchido no momento de
-- ADICIONAR alguém ao combate (snapshot) -- participantes que já
-- estavam em combate antes dessa coluna existir (db/018) ficaram com
-- avatar_url nulo pra sempre, mesmo tendo foto na ficha. Backfill
-- único pra sincronizar quem já está em combate agora.
update combat_participants cp
set avatar_url = c.avatar_url
from characters c
where c.id = cp.character_id
  and cp.avatar_url is null
  and c.avatar_url is not null;
