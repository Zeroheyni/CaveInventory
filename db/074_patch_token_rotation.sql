-- Tabuleiro: rotação dos pins (tokens). null = nunca girado (a lanterna do token segue o movimento, como antes);
-- um número = graus no sentido horário, 0 = apontando pra cima. Pin com luz em feixe aponta o feixe pra onde está virado.
alter table board_tokens add column if not exists rotation real;
alter table board_tokens drop constraint if exists board_tokens_rotation_range;
alter table board_tokens add constraint board_tokens_rotation_range check (rotation is null or (rotation >= 0 and rotation < 360));
