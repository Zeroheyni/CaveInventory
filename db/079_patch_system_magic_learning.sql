-- Sistema de regras "Magic Learning" (Magical Skill Learning): 23 atributos (básicos/sociais/mágicos), testes 1d20 + atributo//2,
-- pontos de ação, mana, sanidade. A ficha mora em characters.system_data.msl (db/071); nível/XP e HP/PE atuais usam as colunas de sempre.
insert into game_systems (id, label, description)
values ('magic-learning', 'Magic Learning',
        'Magical Skill Learning: 23 atributos, testes d20 + atributo/2, pontos de ação (PA/PE), mana (MP), sanidade, perícias, vantagens e 120 magias.')
on conflict (id) do update set label = excluded.label, description = excluded.description, enabled = true;
