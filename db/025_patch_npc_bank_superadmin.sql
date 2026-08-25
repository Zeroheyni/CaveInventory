-- PATCH: mestre global (is_superadmin) também gerencia NPCs de
-- qualquer campanha -- a policy da 024 só cobria o mestre normal de
-- campanha (is_master() and campaign_id = current_campaign_id()),
-- que nunca bate pro mestre global (mesmo padrão de 007/008/009).
create policy "personagem: mestre global gerencia npcs" on characters
  for all using (is_npc and is_superadmin())
  with check (is_npc and is_superadmin());
