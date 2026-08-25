-- Tema agora é preferência da CONTA (profiles), não do personagem --
-- antes ficava em characters.data.theme, então o mestre-superadmin
-- (que não tem personagem, cai direto no painel admin) nunca guardava
-- escolha de tema nenhuma, e o tema só era aplicado depois que a tela
-- do personagem carregava (não no painel admin nem durante o loading).
alter table profiles add column theme text;
