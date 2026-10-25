// Magic Learning (Magical Skill Learning): listas de regras do sistema -- perícias, vantagens, desvantagens, talentos, traumas, tipos de dano.
// Fonte: "MSL_Regras_para_Site.md". Os textos são os do livro; os campos `bonus`/`flags` só existem onde a regra mexe nos números da ficha.

// ---------------------------------------------------------------- perícias
// grau 0 = sem a perícia (rola só com o atributo); 1 básico (+2), 2 treinado (+4), 3 mestre (+6)
export const SKILL_BONUS = { 0: 0, 1: 2, 2: 4, 3: 6 };
export const SKILL_GRADE_LABEL = { 0: 'sem', 1: 'básico', 2: 'treinado', 3: 'mestre' };

export const SKILL_GROUPS = ['Físicas', 'Técnicas', 'Investigação', 'Conhecimento', 'Expressão'];
export const SKILLS = [
  { id: 'atletismo', group: 'Físicas', name: 'Atletismo', hint: 'correr, nadar, escalar', attr: 'forca' },
  { id: 'acrobacia', group: 'Físicas', name: 'Acrobacia', attr: 'agilidade' },
  { id: 'furtividade', group: 'Físicas', name: 'Furtividade', attr: 'agilidade' },
  { id: 'conducao', group: 'Físicas', name: 'Condução', hint: 'carro, moto', attr: 'reflexos' },
  { id: 'medicina', group: 'Técnicas', name: 'Medicina e primeiros socorros', attr: 'intelecto' },
  { id: 'mecanica', group: 'Técnicas', name: 'Mecânica e eletrônica', attr: 'intelecto' },
  { id: 'tecnologia', group: 'Técnicas', name: 'Tecnologia', hint: 'computadores, celulares', attr: 'intelecto' },
  { id: 'arrombamento', group: 'Técnicas', name: 'Arrombamento', attr: 'prec_fisica' },
  { id: 'sobrevivencia', group: 'Técnicas', name: 'Sobrevivência', attr: 'disciplina' },
  { id: 'percepcao', group: 'Investigação', name: 'Percepção', attr: 'perspicacia' },
  { id: 'investigacao', group: 'Investigação', name: 'Investigação', attr: 'intelecto' },
  { id: 'rastreamento', group: 'Investigação', name: 'Rastreamento', attr: 'perspicacia' },
  { id: 'conhecimento_magico', group: 'Conhecimento', name: 'Conhecimento mágico', attr: 'intelecto' },
  { id: 'ciencias', group: 'Conhecimento', name: 'Ciências', attr: 'intelecto' },
  { id: 'historia', group: 'Conhecimento', name: 'História e cultura', attr: 'intelecto' },
  { id: 'atuacao', group: 'Expressão', name: 'Atuação', attr: 'enganacao' },
  { id: 'musica', group: 'Expressão', name: 'Música', attr: 'disciplina' },
  { id: 'oficio', group: 'Expressão', name: 'Ofício', hint: 'culinária, costura etc.; escolher um', attr: 'disciplina', custom: true },
];

// ---------------------------------------------------------------- vantagens (nível = custo em PV)
// bonus: soma permanente no atributo (entra ANTES dos status derivados). flags: mexe em algum número derivado.
export const ADVANTAGES = [
  { id: 'sentidos_agucados', level: 1, name: 'Sentidos Aguçados', text: '+2 em testes de percepção com um sentido escolhido (visão, audição, olfato etc.)', choice: 'sentido' },
  { id: 'observador', level: 1, name: 'Observador', text: '+2 em testes para notar pistas, armadilhas e detalhes escondidos' },
  { id: 'memoria_visual', level: 1, name: 'Memória Visual', text: 'Lembra com exatidão locais e padrões visuais que viu' },
  { id: 'faro_mentiras', level: 1, name: 'Faro para Mentiras', text: '+2 em Perspicácia contra Enganação' },
  { id: 'carismatico', level: 1, name: 'Carismático', text: '+2 em testes sociais com desconhecidos' },
  { id: 'boa_reputacao', level: 1, name: 'Boa Reputação Local', text: '+2 em testes sociais numa região escolhida', choice: 'região' },
  { id: 'linguista', level: 1, name: 'Linguista', text: 'Fala 2 idiomas extras; aprende novos na metade do tempo' },
  { id: 'pes_ligeiros', level: 1, name: 'Pés Ligeiros', text: '+1 m de deslocamento; +2 em furtividade em movimento', flags: { deslocamento: 1 } },
  { id: 'mao_firme', level: 1, name: 'Mão Firme', text: '+2 em ações de controle fino (cirurgia, escrita mágica, desarmar armadilhas)' },
  { id: 'rastreador', level: 1, name: 'Rastreador', text: '+2 em testes de rastreamento' },
  { id: 'resistente', level: 1, name: 'Resistente', text: 'Efeitos físicos por turno (veneno, queimadura, sangramento) duram 1 turno a menos' },
  { id: 'sangue_frio', level: 1, name: 'Sangue Frio', text: '+2 em Autocontrole contra medo e Ameaçar' },
  { id: 'resistencia_mental', level: 1, name: 'Resistência Mental', text: '+2 em Autocontrole nos testes de Sanidade' },
  { id: 'esquiva_instintiva', level: 2, name: 'Esquiva Instintiva', text: '+2 Reflexos; pode desviar mesmo quando pego de surpresa', bonus: { reflexos: 2 } },
  { id: 'robusto', level: 2, name: 'Robusto', text: '+2 Vitalidade', bonus: { vitalidade: 2 } },
  { id: 'folego_de_aco', level: 2, name: 'Fôlego de Aço', text: '+2 Estamina; só desmaia no nível 6 de exaustão', bonus: { estamina: 2 }, flags: { exaustaoMax: 6 } },
  { id: 'pele_grossa', level: 2, name: 'Pele Grossa', text: 'Armadura natural 1, soma com a de itens', flags: { armadura: 1 } },
  { id: 'foco_de_batalha', level: 2, name: 'Foco de Batalha', text: 'Ignora a penalidade de 1 nível de exaustão', flags: { ignoraExaustao: 1 } },
  { id: 'tecnica_precisa', level: 2, name: 'Técnica Precisa', text: '+2 no acerto com um tipo de arma escolhido', choice: 'tipo de arma' },
  { id: 'resistencia_magia', level: 2, name: 'Resistência à Magia', text: '+2 RM', bonus: { res_magica: 2 } },
  { id: 'estavel', level: 2, name: 'Estável', text: '+2 em todos os testes de Autocontrole' },
  { id: 'mestre_em_fuga', level: 2, name: 'Mestre em Fuga', text: '+2 em furtividade, acrobacia e abrir fechaduras' },
  { id: 'famoso', level: 2, name: 'Famoso', text: 'Conhecido num meio escolhido (artista, atleta, influenciador etc.). +2 em testes sociais com quem te reconhece. Pessoas do seu meio te reconhecem sempre. Para as outras, o mestre decide ou rola 1d6 (reconhece com 5 ou 6). Em troca, -2 em disfarce e para passar despercebido em público, e inimigos também te reconhecem', choice: 'meio' },
  { id: 'aprendiz_de_magia', level: 2, name: 'Aprendiz de Magia', text: '+2 nos testes de estudo de magias' },
  { id: 'memoria_muscular', level: 2, name: 'Memória Muscular', text: '+2 nos testes de estudo de técnicas físicas' },
  { id: 'critico_aprimorado', level: 3, name: 'Crítico Aprimorado', text: 'Acerto crítico com 19 ou 20 no d20', flags: { critico: 19 } },
  { id: 'resistencia_elemental', level: 3, name: 'Resistência Elemental', text: 'Escolhe um tipo de dano: sofre metade do dano dele e o efeito nunca se aplica', choice: 'tipo de dano' },
  { id: 'heranca_arcana', level: 3, name: 'Herança Arcana', text: 'Vem de uma família mágica especial: pode aprender as magias da família (Autorização Especial) e começa conhecendo uma delas, de nível 1 ou 2, sem estudar; +1 Decifração', flags: { decifracao: 1 } },
  { id: 'aprendiz_rapido', level: 3, name: 'Aprendiz Rápido', text: 'Precisa de 1 sucesso a menos para aprender magias e técnicas (mínimo 1)' },
  { id: 'mestre_em_armas', level: 3, name: 'Mestre em Armas', text: 'Com um tipo de arma: +2 no acerto, +2 no dano e +1 CE. Não acumula com Técnica Precisa na mesma arma', choice: 'tipo de arma' },
  { id: 'ambidestria', level: 3, name: 'Ambidestria', text: 'Uma vez por turno, depois de atacar, pode atacar com a arma da outra mão por 1 PA' },
  { id: 'vontade_de_ferro', level: 3, name: 'Vontade de Ferro', text: 'Imune a medo; +4 contra controle mental, ilusões e possessão' },
  { id: 'maos_rapidas', level: 3, name: 'Mãos Rápidas', text: '+4 na iniciativa; uma ação menor de manipulação por turno custa 0 PA (sacar, pegar item, ativar runa)', flags: { iniciativa: 4 } },
  { id: 'olho_do_falcao', level: 3, name: 'Olho do Falcão', text: '+2 no acerto à distância; enxerga normalmente com pouca luz' },
  { id: 'especialista_escola', level: 3, name: 'Especialista em Escola', text: 'Escolhe uma escola básica: magias dela custam 1 MP a menos (mínimo 1) e têm +2 na dificuldade para resistir', choice: 'escola' },
  { id: 'reflexos_sobre_humanos', level: 3, name: 'Reflexos Sobre-Humanos', text: 'Desviar custa 1 PA' },
  { id: 'aura_intimidadora', level: 3, name: 'Aura Intimidadora', text: '+4 em Ameaçar; NPCs de nível menor que o seu que falharem contra você perdem 1 PA' },
];

// ---------------------------------------------------------------- desvantagens (nível = PV que dá na criação)
export const DISADVANTAGES = [
  { id: 'ingenuo', level: 1, kind: 'Comum', name: 'Ingênuo', text: '-2 em Perspicácia contra Enganação' },
  { id: 'pessimo_mentiroso', level: 1, kind: 'Comum', name: 'Péssimo Mentiroso', text: '-2 em Enganação' },
  { id: 'visao_ruim', level: 1, kind: 'Comum', name: 'Visão Ruim', text: '-2 no acerto à distância e na percepção visual de longe' },
  { id: 'intolerancia', level: 1, kind: 'Comum', name: 'Intolerância', text: '-2 em testes sociais com um grupo escolhido; hostilidade com ele', choice: 'grupo' },
  { id: 'medroso', level: 1, kind: 'Comum', name: 'Medroso', text: '-2 em Autocontrole contra medo e Ameaçar' },
  { id: 'medo_de_altura', level: 1, kind: 'Comum', name: 'Medo de Altura', text: '-2 em testes físicos e de concentração em lugares altos' },
  { id: 'tosse_cronica', level: 1, kind: 'Comum', name: 'Tosse Crônica', text: '-2 em furtividade; encantamentos têm -2 na dificuldade para resistir' },
  { id: 'voz_rouca', level: 1, kind: 'Comum', name: 'Voz Rouca', text: '-2 em testes sociais falados; encantamentos têm -2 na dificuldade para resistir' },
  { id: 'mau_olhado', level: 1, kind: 'Comum', name: 'Mau Olhado', text: '-2 em testes sociais com desconhecidos' },
  { id: 'alergia_comum', level: 1, kind: 'Comum', name: 'Alergia Comum', text: 'Perto do alérgeno, -2 em ações prolongadas', choice: 'alérgeno' },
  { id: 'mao_tremequeira', level: 1, kind: 'Comum', name: 'Mão Tremequeira', text: '-2 em ações de controle fino' },
  { id: 'sono_pesado', level: 1, kind: 'Comum', name: 'Sono Pesado', text: '-4 para acordar e reagir a emboscadas durante o sono' },
  { id: 'sono_leve', level: 2, kind: 'Comum', name: 'Sono Leve', text: 'Sem silêncio e conforto, o descanso recupera só metade do PE' },
  { id: 'propenso_ferimentos', level: 2, kind: 'Comum', name: 'Propenso a Ferimentos', text: 'Morre com -10 de HP, em vez de -16', flags: { morteHp: -10 } },
  { id: 'mente_aberta', level: 2, kind: 'Comum', name: 'Mente Aberta', text: '-2 RM contra controle mental e persuasão mágica' },
  { id: 'divida_de_jogo', level: 2, kind: 'Comum', name: 'Dívida de Jogo', text: 'Deve a gente perigosa; pode ser perseguido, cobrado ou traído' },
  { id: 'alergia_metais', level: 2, kind: 'Comum', name: 'Alergia a Metais', text: '-2 no acerto com armas de metal; não pode usar armadura metálica' },
  { id: 'dieta_restrita', level: 2, kind: 'Comum', name: 'Dieta Restrita', text: 'Sem a comida certa, o descanso não recupera HP', choice: 'dieta' },
  { id: 'vicio', level: 2, kind: 'Comum', name: 'Vício', text: 'A cada dia sem a substância, -1 em todos os testes (até -4)', choice: 'substância' },
  { id: 'perna_machucada', level: 2, kind: 'Comum', name: 'Perna Machucada', text: '-2 m de deslocamento; -2 em corrida e saltos', flags: { deslocamento: -2 } },
  { id: 'instabilidade_magica', level: 2, kind: 'Comum', name: 'Instabilidade Mágica', text: 'Ao conjurar, rola d10: no 1 a magia falha e o MP é gasto' },
  { id: 'rejeicao_social', level: 2, kind: 'Comum', name: 'Rejeição Social', text: '-2 em testes sociais com pessoas de status elevado' },
  { id: 'incapaz_de_mentir', level: 2, kind: 'Comum', name: 'Incapaz de Mentir', text: 'Falha automaticamente em Enganação' },
  { id: 'marcado', level: 2, kind: 'Mágica', name: 'Marcado', text: 'Seus rastros mágicos sempre identificam você e duram um nível a mais' },
  { id: 'tatuagem_maldita', level: 2, kind: 'Mágica', name: 'Tatuagem Maldita', text: 'Criaturas mágicas percebem você de longe; -2 RM contra um tipo de magia definido pelo mestre' },
  { id: 'dever_familiar', level: 2, kind: 'Mágica', name: 'Dever Familiar', text: 'Obrigações com a família ou clã; pode ser chamado de volta em momentos críticos' },
  { id: 'braco_mecanico', level: 2, kind: 'Mágica', name: 'Braço Mecânico', text: '-2 em força e controle fino com esse braço; a prótese aceita melhorias' },
  { id: 'juramento_de_sangue', level: 2, kind: 'Mágica', name: 'Juramento de Sangue', text: 'Jurou proteger ou vingar alguém; em certas situações não pode recusar ajuda nem se afastar' },
  { id: 'mente_fragmentada', level: 3, kind: 'Comum', name: 'Mente Fragmentada', text: 'Nunca faz o teste de Autocontrole para reduzir perda de Sanidade' },
  { id: 'mana_instavel', level: 3, kind: 'Comum', name: 'Mana Instável', text: 'Ao chegar a 0 MP, sofre 2d6 de dano e um efeito mágico aleatório' },
  { id: 'trauma_profundo', level: 3, kind: 'Comum', name: 'Trauma Profundo', text: 'Começa com um trauma da tabela de Sanidade' },
  { id: 'inimigo_mortal', level: 3, kind: 'Comum', name: 'Inimigo Mortal', text: 'Alguém muito perigoso está atrás de você e pode aparecer a qualquer momento' },
  { id: 'cego_um_olho', level: 3, kind: 'Comum', name: 'Cego de um Olho', text: '-4 no acerto à distância; -2 em percepção visual' },
  { id: 'coracao_fragil', level: 3, kind: 'Comum', name: 'Coração Frágil', text: '-10 de HP máximo; desmaia no nível 3 de exaustão. Sustos: ao sofrer um ataque letal ou uma perda grave de Sanidade, teste d20 + Vitalidade ÷ 2 contra 15; se falhar, desmaia', flags: { hpMax: -10, exaustaoMax: 3 } },
  { id: 'toque_da_morte', level: 3, kind: 'Mágica', name: 'Toque da Morte', text: 'Curas recebidas têm metade do efeito; animais evitam você' },
  { id: 'maldicao_sangrenta', level: 3, kind: 'Mágica', name: 'Maldição Sangrenta', text: 'Ao sofrer dano, rola d6: no 1 ocorre um efeito colateral escolhido pelo mestre' },
  { id: 'pacto_obscuro', level: 3, kind: 'Mágica', name: 'Pacto Obscuro', text: 'Trato com uma entidade; o mestre define o que ela dá e o que pode exigir' },
  { id: 'amnesia', level: 3, kind: 'Mágica', name: 'Amnésia', text: 'Lacunas na memória; magias, aliados ou inimigos desconhecidos definidos pelo mestre' },
  { id: 'odio_ancestral', level: 3, kind: 'Mágica', name: 'Ódio Ancestral', text: '-4 em Autocontrole perto de um grupo escolhido; não coopera com ele', choice: 'grupo' },
  { id: 'marca_da_morte', level: 3, kind: 'Mágica', name: 'Marca da Morte', text: 'Criaturas mágicas percebem você; -2 RM contra maldições; +50% de dano de sombra recebido' },
];
export const DISADVANTAGE_PV_MAX = 8; // soma máxima de PV de desvantagens na criação (no máx. uma de nível 3 em cada lista)

// ---------------------------------------------------------------- talentos (ações/reações exclusivas; vêm de vencer campanhas)
export const TALENTS = [
  { id: 'concentrar', name: 'Concentrar', kind: 'Ação', pa: 3, text: 'Dá vantagem no próximo turno. Não pode reagir até lá; se for atacado, perde a concentração' },
  { id: 'estudar', name: 'Estudar', kind: 'Ação ou reação', pa: 1, text: 'Estuda ambiente, magias, ataques ou inimigos (Decifração para magias, Perspicácia para inimigos)' },
  { id: 'desarmar', name: 'Desarmar', kind: 'Ação', pa: 2, text: 'Tira a arma corpo a corpo do oponente: Força ou Precisão Física contra Força do alvo; a arma cai a 1d4 m' },
  { id: 'provocar', name: 'Provocar', kind: 'Ação', pa: 2, text: 'Faz o oponente atacar você (contra Autocontrole)' },
  { id: 'inspirar', name: 'Inspirar', kind: 'Ação', pa: 2, text: 'Facilita as ações de aliados' },
  { id: 'retruque', name: 'Retruque', kind: 'Reação', pa: 2, text: 'Quando um inimigo à vista conjura, você conjura uma magia sua na hora, e a sua resolve primeiro. O MP conta no Fluxo do seu próximo turno. Uma vez por rodada. Se for diretamente oposta (fogo contra gelo, escudo contra projétil), o mestre pode decidir que anula ou reduz a do inimigo' },
  { id: 'defender_aliado', name: 'Defender aliado', kind: 'Reação', pa: 2, text: 'Pula na frente de um ataque contra um aliado' },
  { id: 'contra_ataque', name: 'Contra-ataque', kind: 'Reação', pa: 2, text: 'Depois de um desvio bem-sucedido, ataca em seguida' },
  { id: 'interromper', name: 'Interromper', kind: 'Reação', pa: 2, text: 'Quebra a concentração de alguém' },
];

// ---------------------------------------------------------------- sanidade: traumas (d8) e perdas por gravidade
export const TRAUMAS = [
  { d: 1, name: 'Fobia', text: '-2 em todos os testes perto do gatilho' },
  { d: 2, name: 'Pesadelos', text: 'O descanso recupera só metade do PE' },
  { d: 3, name: 'Paralisia de medo', text: 'Ao ver o gatilho, teste de Autocontrole ou perde 2 PA' },
  { d: 4, name: 'Tremores', text: '-2 em Precisão' },
  { d: 5, name: 'Paranoia', text: '-2 em testes sociais; não confia em ninguém' },
  { d: 6, name: 'Agressividade', text: 'Testes de Acalmar contra o personagem têm -4' },
  { d: 7, name: 'Culpa', text: 'Ameaçar contra o personagem ganha +2' },
  { d: 8, name: 'Dissociação', text: 'No começo de um combate, teste de Autocontrole ou perde o primeiro turno' },
];
export const SANITY_LOSS = [
  { id: 'leve', label: 'Leve', dice: [1, 6], dc: 12 },
  { id: 'moderada', label: 'Moderada', dice: [2, 6], dc: 15 },
  { id: 'grave', label: 'Grave', dice: [3, 6], dc: 18 },
  { id: 'extrema', label: 'Extrema', dice: [4, 6], dc: 21 },
];

// ---------------------------------------------------------------- tipos de dano (d100 pro efeito) e manobras -- consulta rápida
export const DAMAGE_TYPES = [
  { id: 'cortante', name: 'Cortante', chance: '20%', effect: 'Sangramento: 5% do HP máximo por turno, até ser tratado' },
  { id: 'impacto', name: 'Impacto', chance: '20%', effect: '-1 PA no próximo turno' },
  { id: 'perfurante', name: 'Perfurante', chance: 'sempre', effect: 'Ignora metade da armadura, arredondando pra cima' },
  { id: 'fogo', name: 'Fogo', chance: '30%', effect: 'Queimadura: 7% do HP máximo por turno, por 3 turnos' },
  { id: 'gelo', name: 'Gelo', chance: '25%', effect: '-2 PA no próximo turno' },
  { id: 'eletricidade', name: 'Eletricidade', chance: '25%', effect: '-20% de Fluxo (mínimo -2) no próximo turno. Com 10% de chance, perde o turno em vez disso' },
  { id: 'vento', name: 'Vento', chance: '30%', effect: 'Sempre empurra 2 m. Efeito: -20% de Reflexos (mínimo -2) por 2 turnos' },
  { id: 'terra', name: 'Terra', chance: '20%', effect: 'Metade do deslocamento no próximo turno' },
  { id: 'sombra', name: 'Sombra', chance: '20%', effect: '-20% de RM (mínimo -2) por 2 turnos' },
  { id: 'luz', name: 'Luz', chance: 'sempre', effect: '+20% de dano contra mortos-vivos e entidades sombrias' },
];
export const ELEMENTS = ['fogo', 'gelo', 'eletricidade', 'vento', 'terra', 'sombra', 'luz'];
export const SCHOOLS = ['Mágica', 'Encantamentos', 'Maldições', 'Sentivar', 'Arcanismo', 'Invocação'];

export const ACTIONS = [
  { name: 'Ação menor (sacar, pegar item)', kind: 'Ação', pa: 1 },
  { name: 'Atacar', kind: 'Ação', pa: 2 },
  { name: 'Usar magia', kind: 'Ação', pa: '2 (a magia pode dizer outro valor)' },
  { name: 'Mover', kind: 'Ação', pa: 2 },
  { name: 'Correr (dobra o deslocamento)', kind: 'Ação', pa: 3 },
  { name: 'Recuar com cuidado (metade do deslocamento, sem golpe de oportunidade)', kind: 'Ação', pa: 3 },
  { name: 'Agarrar / Escapar / Empurrar / Derrubar / Arremessar', kind: 'Ação', pa: 2 },
  { name: 'Levantar (estando caído)', kind: 'Ação', pa: 2 },
  { name: 'Desviar', kind: 'Reação', pa: 2 },
  { name: 'Bloquear', kind: 'Reação', pa: 2 },
  { name: 'Golpe de oportunidade (1 vez por rodada)', kind: 'Reação', pa: 1 },
];

// condições de combate (chips no rastreador/tabuleiro) -- as que as regras descrevem
export const MSL_CONDITIONS = [
  { key: 'sangrando', label: 'Sangrando', icon: '🩸', color: '#ff5a5a' },
  { key: 'queimando', label: 'Queimando', icon: '🔥', color: '#ff8a4c' },
  { key: 'impactado', label: 'Impacto (−1 PA)', icon: '💥', color: '#ffb84d' },
  { key: 'desmaiado', label: 'Desmaiado', icon: '😵', color: '#a3a3a3' },
  { key: 'congelado', label: 'Gelo (-2 PA)', icon: '❄', color: '#5ad4ff' },
  { key: 'eletrizado', label: 'Eletrizado', icon: '⚡', color: '#ffd93d' },
  { key: 'ventania', label: 'Vento (-Reflexos)', icon: '🌪', color: '#9db4c7' },
  { key: 'enterrado', label: 'Terra (deslocamento ½)', icon: '🪨', color: '#c9b878' },
  { key: 'sombrio', label: 'Sombra (-RM)', icon: '🌑', color: '#b98bff' },
  { key: 'agarrado', label: 'Agarrado', icon: '🤼', color: '#ffb84d' },
  { key: 'caido', label: 'Caído', icon: '⬇', color: '#a3a3a3' },
  { key: 'exausto', label: 'Exausto', icon: '😮‍💨', color: '#ffd93d' },
  { key: 'concentrado', label: 'Concentrado', icon: '🎯', color: '#4ade80' },
  { key: 'amedrontado', label: 'Amedrontado', icon: '😨', color: '#b98bff' },
];
