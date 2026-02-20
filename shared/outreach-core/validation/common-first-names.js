/**
 * Common First Names Dictionary
 *
 * Used for dictionary-based splitting of concatenated email usernames
 * e.g., "kategymer" → match "kate" → split → "Kate Gymer"
 *
 * ~1400 common international first names, sorted by length descending
 * for longest-match-first extraction.
 *
 * Covers: UK/English, Welsh, Scottish, Irish, Spanish, Portuguese,
 * Catalan, Basque, Galician, Scandinavian (Danish/Swedish/Norwegian),
 * Indian (North/South/Bengali/Marathi), Pakistani, NZ/Pacific,
 * Polish/Eastern European (Czech, Slovak, Romanian, Hungarian, Lithuanian),
 * Italian, French, German/Austrian, Turkish, Greek,
 * African (West/East African, Caribbean), Chinese, Korean, Japanese,
 * Vietnamese, and more.
 *
 * IMPORTANT: Only include FIRST names, not surnames.
 * This prevents false splits like "markham" → "Mark Ham"
 * (because "Markham" is a surname, not in this list).
 */

const COMMON_FIRST_NAMES = [
  // ══════════════════════════════════════════════════════════════
  // UK / ENGLISH / AMERICAN
  // ══════════════════════════════════════════════════════════════

  // ── Female (UK/US) ──
  'aaliyah', 'abbie', 'abigail', 'adelaide', 'adriana', 'alexandra',
  'alice', 'alicia', 'alison', 'amanda', 'amber', 'amelia', 'amy',
  'andrea', 'angela', 'anita', 'anna', 'anne', 'annie', 'aubrey',
  'audrey', 'aurora', 'ava',
  'barbara', 'beatrice', 'becky', 'bella', 'beth', 'bethany',
  'beverley', 'brenda', 'bridget', 'brittany', 'brooke',
  'caitlin', 'carol', 'caroline', 'carolyn', 'catherine', 'charlotte',
  'cheryl', 'chloe', 'christine', 'claire', 'clara', 'colleen',
  'connie', 'courtney',
  'daisy', 'danielle', 'dawn', 'debbie', 'deborah', 'denise',
  'destiny', 'diana', 'diane', 'donna', 'dorothy',
  'eileen', 'elaine', 'eleanor', 'elena', 'elizabeth', 'ella',
  'ellie', 'emily', 'emma', 'erica', 'erin', 'esther', 'eva',
  'eve', 'evelyn',
  'fatima', 'faye', 'fiona', 'florence', 'frances', 'francesca',
  'frankie', 'freya',
  'gabrielle', 'gail', 'gemma', 'georgia', 'gillian', 'grace', 'gwen',
  'hailey', 'hannah', 'harper', 'harriet', 'heather', 'helen',
  'hilary', 'holly',
  'imogen', 'irene', 'iris', 'isabel', 'isabella', 'isobel', 'isla', 'ivy',
  'jackie', 'jacqueline', 'jade', 'jane', 'janet', 'janice', 'jasmine',
  'jean', 'jemma', 'jennifer', 'jenny', 'jessica', 'jill', 'joan',
  'joanna', 'joanne', 'josephine', 'joy', 'joyce', 'judith', 'judy',
  'julia', 'julie', 'june',
  'karen', 'kate', 'katherine', 'kathleen', 'kathryn', 'katie',
  'kay', 'kayla', 'kayleigh', 'kelly', 'kerry', 'kim', 'kimberly',
  'kirsten',
  'latoya', 'laura', 'lauren', 'leah', 'lesley', 'lily', 'linda',
  'lisa', 'liz', 'lizzie', 'lorna', 'lorraine', 'louise', 'lucia',
  'lucy', 'lydia', 'lynn',
  'maddison', 'madeleine', 'madelyn', 'madison', 'maggie', 'maisie',
  'mandy', 'margaret', 'maria', 'marie', 'marilyn', 'marion',
  'martha', 'mary', 'matilda', 'maureen', 'maxine', 'megan',
  'melanie', 'melissa', 'mia', 'michelle', 'mila', 'millie',
  'miranda', 'molly', 'monica', 'moira', 'monique',
  'nadine', 'nancy', 'naomi', 'natalie', 'natasha', 'nia', 'nicola',
  'nina', 'nora',
  'olivia',
  'paige', 'pamela', 'patricia', 'paula', 'pauline', 'penelope',
  'penny', 'phoebe', 'pippa', 'polly', 'poppy', 'priya',
  'rachel', 'rebecca', 'riley', 'rita', 'roberta', 'rosalind',
  'rose', 'rosemary', 'rosie', 'ruby', 'ruth',
  'sally', 'samantha', 'sandra', 'sarah', 'savannah', 'scarlett',
  'shannon', 'sharon', 'sheila', 'shirley', 'sienna', 'simone',
  'sophia', 'sophie', 'stacey', 'stella', 'stephanie', 'sue',
  'susan', 'suzanne', 'suzie', 'sydney', 'sylvia',
  'tamara', 'tanya', 'tara', 'taylor', 'teresa', 'tessa', 'tina',
  'tracy', 'trudy',
  'valerie', 'vanessa', 'vera', 'veronica', 'vicky', 'victoria',
  'violet', 'virginia', 'vivian',
  'wendy', 'wilma',
  'yasmin', 'yvonne',
  'zara', 'zoe',

  // ── Male (UK/US) ──
  'aaron', 'adam', 'adrian', 'aidan', 'aiden', 'alan', 'albert',
  'alex', 'alexander', 'alfie', 'andrew', 'anthony', 'archie',
  'arlo', 'arthur', 'ashley', 'ashton', 'austin',
  'barry', 'ben', 'benjamin', 'blake', 'bobby', 'brad', 'bradley',
  'brandon', 'brian', 'brodie', 'bruce',
  'caleb', 'callum', 'cameron', 'carl', 'carter', 'charles',
  'charlie', 'chris', 'christopher', 'clark', 'clive', 'colin',
  'connor', 'cooper', 'corey', 'craig',
  'dale', 'damian', 'daniel', 'darren', 'dave', 'david', 'dean',
  'dennis', 'derek', 'derrick', 'devon', 'dion', 'dominic',
  'donald', 'douglas', 'duncan', 'dylan',
  'eddie', 'edward', 'elliot', 'elliott', 'ellis', 'eric', 'ethan', 'evan',
  'felix', 'finley', 'finn', 'francis', 'frank', 'fred', 'freddie',
  'gabriel', 'gareth', 'gary', 'gavin', 'george', 'gordon', 'graeme',
  'graham', 'grant', 'greg', 'gregory', 'guy',
  'harry', 'harvey', 'hayden', 'henry', 'howard', 'hudson', 'hugo',
  'hunter',
  'ian', 'isaac', 'ivan',
  'jack', 'jacob', 'jake', 'jamal', 'james', 'jamie', 'jason',
  'jayden', 'jeff', 'jeffrey', 'jeremy', 'jesse', 'jimmy', 'joel',
  'john', 'jonathan', 'jordan', 'joseph', 'josh', 'joshua',
  'julian', 'justin',
  'karl', 'keith', 'ken', 'kenneth', 'kevin', 'kieran', 'kyle',
  'lance', 'lawrence', 'lee', 'leighton', 'leo', 'leon', 'leonard',
  'lewis', 'liam', 'lloyd', 'logan', 'louis', 'lucas', 'luke',
  'malcolm', 'malik', 'marcus', 'mark', 'marshall', 'martin',
  'mason', 'matt', 'matthew', 'max', 'maxwell', 'michael', 'mike',
  'miles', 'mitchell', 'morgan',
  'nathan', 'neil', 'nicholas', 'nick', 'nigel', 'noah', 'noel', 'norman',
  'oliver', 'ollie', 'oscar', 'owen',
  'patrick', 'paul', 'pete', 'peter', 'phil', 'philip',
  'quentin',
  'ralph', 'ray', 'raymond', 'reg', 'rhys', 'richard', 'rick',
  'rob', 'robert', 'robin', 'rodney', 'roger', 'ronald', 'ross',
  'roy', 'rupert', 'russell', 'ryan',
  'sam', 'samuel', 'scott', 'sean', 'sebastian', 'shane', 'shaun',
  'simon', 'spencer', 'stanley', 'stefan', 'stephen', 'steve',
  'steven', 'stewart', 'stuart',
  'terrence', 'terry', 'theo', 'thomas', 'tim', 'timothy', 'toby',
  'todd', 'tom', 'tommy', 'tony', 'trevor', 'tristan', 'tyler',
  'victor', 'vincent',
  'warren', 'wayne', 'william',
  'zach', 'zachary',

  // ══════════════════════════════════════════════════════════════
  // WELSH
  // ══════════════════════════════════════════════════════════════
  'alun', 'arwel', 'bethan', 'carwyn', 'cerys', 'cian',
  'daffydd', 'eirianwen', 'eirian', 'elinor',
  'fflur', 'gwenllian', 'gwynfor', 'gwyn',
  'harri', 'hywel',
  'idris', 'iestyn', 'ieuan',
  'lowri',
  'rhian', 'rhiannon',
  'seren', 'sian',
  'tomos',

  // ══════════════════════════════════════════════════════════════
  // SCOTTISH
  // ══════════════════════════════════════════════════════════════
  'ailsa', 'alastair', 'angus',
  'calum', 'eilidh', 'euan', 'ewan',
  'finlay', 'greig',
  'hamish',
  'iain', 'innes',
  'kenny', 'kirsty',
  'lachlan',
  'mairi', 'morag', 'murdo',
  'rory',
  'shona',

  // ══════════════════════════════════════════════════════════════
  // IRISH
  // ══════════════════════════════════════════════════════════════
  'aisling', 'aodhan', 'aoife',
  'bronagh',
  'cathal', 'ciaran', 'cliodhna', 'colm', 'conor',
  'darragh', 'declan', 'diarmuid',
  'eoin',
  'fergal', 'fionnuala',
  'grainne',
  'niamh',
  'oisin', 'orla',
  'padraig',
  'ronan', 'roisin',
  'saoirse', 'sinead', 'siobhan',

  // ══════════════════════════════════════════════════════════════
  // SPANISH
  // ══════════════════════════════════════════════════════════════
  'alba', 'alberto', 'alejandro', 'alicia', 'alvaro', 'ana',
  'antonio',
  'carmen', 'carlos', 'carla', 'claudia', 'cristina',
  'diego', 'elena',
  'fernando', 'francisco',
  'gonzalo',
  'hugo',
  'ines', 'irene', 'isabel',
  'javier', 'jorge', 'jose', 'juan',
  'lucia', 'luis',
  'manuel', 'marcos', 'mariano', 'marta', 'miguel',
  'miguelangel',  // compound first name (Miguel Ángel)
  'noelia',
  'pablo', 'patricia', 'paula', 'pedro',
  'rafel', 'raul', 'rocio', 'rosa',
  'sergio', 'silvia', 'sofia',

  // ══════════════════════════════════════════════════════════════
  // PORTUGUESE
  // ══════════════════════════════════════════════════════════════
  'andre', 'andreia',
  'beatriz', 'bruno',
  'catarina',
  'daniela', 'diogo',
  'elisa',
  'filipe', 'francisco',
  'goncalo', 'guilherme',
  'joana', 'joao',
  'joaopedro',  // compound first name (João Pedro)
  'margarida', 'mariana', 'mateus',
  'paulo',
  'raquel', 'rita', 'rodrigo',
  'tiago',

  // ══════════════════════════════════════════════════════════════
  // CATALAN
  // ══════════════════════════════════════════════════════════════
  'arnau',
  'jordi',
  'laia',
  'marc', 'meritxell', 'montserrat',
  'nuria',
  'oriol',
  'pol',
  'xavier',

  // ══════════════════════════════════════════════════════════════
  // BASQUE
  // ══════════════════════════════════════════════════════════════
  'aitor', 'ander', 'arantzazu', 'asier',
  'gorka',
  'iratxe',
  'leire',
  'maialen',
  'nerea',
  'unai',
  'xabier',

  // ══════════════════════════════════════════════════════════════
  // GALICIAN
  // ══════════════════════════════════════════════════════════════
  'breo', 'breogan',
  'iria',
  'uxia',
  'xoan',

  // ══════════════════════════════════════════════════════════════
  // SCANDINAVIAN (Danish, Swedish, Norwegian)
  // ══════════════════════════════════════════════════════════════
  'anders', 'andreas', 'arvid', 'astrid', 'axel', 'alva',
  'camilla',
  'elias', 'elina', 'emil', 'erik', 'espen',
  'frederik', 'freja', 'frida',
  'gustav',
  'hans', 'henrik', 'hilda',
  'ida', 'ingeborg', 'ingrid', 'isak',
  'johannes', 'johanna', 'jonas', 'josefine',
  'kasper', 'kristian',
  'linus', 'linnea',
  'mads', 'magnus', 'maja', 'malin', 'marthe', 'mathilde', 'mette',
  'nanna',
  'olaus', 'oskar',
  'rasmus',
  'selma', 'sigrid', 'simen', 'sofie',
  'tobias', 'truls',
  'vilde', 'viktor', 'ville',

  // ══════════════════════════════════════════════════════════════
  // INDIAN (Hindi, Bengali, Marathi, South Indian, Punjabi)
  // ══════════════════════════════════════════════════════════════
  'aarav', 'aditya', 'aishwarya', 'ajay', 'akash', 'amit', 'amruta',
  'anand', 'ananya', 'anil', 'anindya', 'anjali', 'ankit', 'anish',
  'apoorva', 'archana', 'arjun', 'arnab', 'arpit', 'asha', 'aswini',
  'bhavya',
  'debojyoti', 'deepak', 'deepika', 'dev', 'devika', 'divya',
  'gautam', 'gurpreet',
  'harish', 'harpreet', 'harshit', 'hemant',
  'indraneet', 'inder', 'isha',
  'kabir', 'karthik', 'kavita', 'keerthi', 'kiran', 'kumar',
  'lakshmi',
  'madhav', 'manoj', 'mayank', 'meera', 'megha', 'mohit',
  'naina', 'neel', 'neelam', 'neha', 'nikhil', 'nisha', 'nitin',
  'pallavi', 'pooja', 'pradeep', 'prakash', 'prasad', 'priya',
  'priyanka',
  'radhika', 'rahul', 'raj', 'raja', 'rakesh', 'rana', 'ravi',
  'reema', 'rishi', 'ritu', 'rohan', 'rohit',
  'sahil', 'samir', 'sanjay', 'santhosh', 'sayali', 'sayantan',
  'shivani', 'shreya', 'shreyas', 'shruti', 'siddharth', 'simran', 'sneha',
  'sonia', 'soumya', 'subhajit', 'sujit', 'sunita', 'suresh',
  'sushma', 'swapnil',
  'tanvi', 'tarun',
  'varun', 'vignesh', 'vijay', 'vikram', 'vinay', 'vishal', 'vivaan',
  'yash',

  // ══════════════════════════════════════════════════════════════
  // PAKISTANI / MIDDLE EASTERN
  // ══════════════════════════════════════════════════════════════
  'aaliya', 'aamir', 'abdullah', 'adeel', 'ahmed', 'ahsan', 'aisha',
  'ali', 'alishba', 'amir', 'anam', 'anas', 'aqib', 'areeba',
  'asad', 'asim', 'atif', 'ayaan', 'ayesha', 'azhar',
  'bilal',
  'danish', 'daniyal',
  'fahad', 'fahim', 'faraz', 'farhan', 'fawad',
  'hafsa', 'hamza', 'hassan', 'hina', 'hira', 'hussain',
  'iman', 'imran', 'iqra', 'irfan',
  'javed',
  'kamil', 'kamran', 'khalid', 'kinza',
  'laiba', 'layla',
  'maryam', 'moiz', 'mohamed', 'mohammed', 'mohsin', 'muhammad',
  'muneeb',
  'nadia', 'nasir', 'naveed', 'navid', 'nimra', 'noman', 'noor',
  'omar', 'owais',
  'parvez',
  'rehan', 'rizwan',
  'saad', 'sajid', 'salim', 'salman', 'samiya', 'sana', 'sara',
  'sarmad', 'shahid', 'shahzaib', 'shayan', 'sheryar', 'shoaib',
  'talha', 'tariq', 'tauseef', 'tayyab',
  'umar', 'umair', 'usman',
  'waqas', 'waseem',
  'yasin', 'yasir', 'yusuf',
  'zain', 'zainab', 'zahid', 'zeeshan', 'zubair',

  // ══════════════════════════════════════════════════════════════
  // NZ / PACIFIC / MĀORI
  // ══════════════════════════════════════════════════════════════
  'aroha',
  'greer',
  'manaia',
  'tane',

  // ══════════════════════════════════════════════════════════════
  // POLISH / EASTERN EUROPEAN
  // ══════════════════════════════════════════════════════════════

  // ── Polish Female ──
  'agata', 'agnieszka', 'aleksandra', 'alicja', 'anna', 'aneta',
  'beata', 'bozena',
  'dagmara', 'danuta', 'dominika', 'dorota',
  'edyta', 'elzbieta', 'emilia', 'ewa',
  'gabriela', 'grazyna',
  'halina',
  'ilona', 'iwona', 'izabela',
  'jadwiga', 'jagoda', 'joanna', 'jolanta', 'justyna',
  'kamila', 'karolina', 'katarzyna', 'kinga', 'klaudia',
  'krystyna',
  'lidia',
  'magdalena', 'malgorzata', 'marta', 'martyna', 'milena',
  'monika',
  'natalia',
  'patrycja', 'paulina',
  'renata',
  'sandra', 'sylwia',
  'urszula',
  'wanda', 'weronika', 'wioletta',
  'zofia', 'zuzanna',

  // ── Polish Male ──
  'andrzej', 'arkadiusz', 'artur',
  'bartlomiej', 'bartosz', 'blazej', 'bogdan',
  'czeslaw',
  'dariusz', 'dawid',
  'filip',
  'grzegorz',
  'henryk',
  'jacek', 'jakub', 'jan', 'janusz', 'jarek', 'jaroslaw', 'jerzy',
  'karol', 'kazimierz', 'konrad', 'krystian', 'krzysztof',
  'lech', 'leszek', 'lukasz',
  'maciej', 'marcin', 'marek', 'mariusz', 'mateusz', 'michal',
  'miroslaw',
  'norbert',
  'patryk', 'pawel', 'piotr', 'przemyslaw',
  'radoslaw', 'rafal', 'remigiusz', 'robert', 'roman', 'ryszard',
  'sebastian', 'slawek', 'slawomir', 'stanislaw', 'stefan',
  'szymon',
  'tadeusz', 'tomasz',
  'waldemar', 'wiktor', 'witold', 'wojciech',
  'zbigniew', 'zenon',

  // ── Czech / Slovak ──
  'hana', 'jana', 'jitka', 'lucie', 'petra', 'veronika',
  'frantisek', 'jiri', 'lukas', 'martin', 'miroslav', 'ondrej',
  'pavel', 'petr', 'radek', 'tomas', 'vaclav', 'vladimir', 'zdenek',

  // ── Romanian ──
  'alina', 'anca', 'andreea', 'cristina', 'ioana', 'mihaela',
  'raluca', 'roxana',
  'alexandru', 'bogdan', 'ciprian', 'cosmin', 'cristian', 'florin',
  'ionut', 'marian', 'mihai', 'razvan', 'sorin', 'stefan', 'vlad',

  // ── Hungarian ──
  'aniko', 'eszter', 'katalin', 'zsuzsa',
  'attila', 'balazs', 'gabor', 'gyorgy', 'istvan', 'janos',
  'laszlo', 'sandor', 'tamas', 'tibor', 'zoltan', 'zsolt',

  // ── Lithuanian / Latvian ──
  'ausra', 'dalia', 'rasa', 'ruta', 'vilma',
  'algis', 'dainius', 'giedrius', 'mindaugas', 'rolandas',
  'tomas', 'valdas', 'vytautas',

  // ══════════════════════════════════════════════════════════════
  // ITALIAN
  // ══════════════════════════════════════════════════════════════
  'alessandra', 'alessia', 'antonella', 'arianna',
  'bianca',
  'chiara', 'cinzia',
  'federica', 'flavia',
  'giada', 'giorgia', 'giovanna', 'giulia', 'giuliana',
  'ilaria',
  'luisa',
  'margherita', 'michela',
  'ornella',
  'paola',
  'roberta', 'rossella',
  'sabrina', 'serena', 'simona',
  'valentina',
  'alessio', 'aldo', 'andrea', 'angelo',
  'claudio', 'cristiano',
  'davide',
  'edoardo', 'emanuele', 'enrico', 'enzo',
  'fabio', 'fabrizio', 'filippo', 'flavio',
  'giacomo', 'gianluca', 'gianluigi', 'gianmarco', 'giorgio',
  'giovanni', 'giuseppe', 'guido',
  'leonardo', 'lorenzo', 'luca', 'luciano', 'luigi',
  'marco', 'massimo', 'matteo', 'mauro',
  'nicola',
  'paolo', 'pasquale', 'pietro',
  'raffaele', 'riccardo', 'roberto',
  'salvatore', 'simone', 'stefano',
  'tommaso',
  'umberto',
  'vincenzo', 'vittorio',

  // ══════════════════════════════════════════════════════════════
  // FRENCH
  // ══════════════════════════════════════════════════════════════
  'amelie', 'aurelie',
  'brigitte',
  'celine', 'chantal', 'clementine',
  'delphine',
  'elodie',
  'genevieve',
  'helene',
  'isabelle',
  'juliette',
  'laetitia', 'laurence', 'lucienne',
  'margaux', 'mathilde',
  'nathalie',
  'odette',
  'pascale',
  'sylvie',
  'therese',
  'veronique',
  'alain', 'arnaud', 'antoine',
  'baptiste', 'benoit', 'bertrand',
  'cedric', 'claude', 'cyrille',
  'denis',
  'edouard', 'emmanuel', 'etienne',
  'fabien', 'florian', 'franck', 'frederic',
  'gael', 'gauthier', 'gerard', 'gilles', 'guillaume',
  'herve',
  'jacques', 'julien',
  'laurent', 'lionel', 'loic', 'lucien',
  'marcel', 'mathieu', 'maxime', 'michel',
  'nicolas',
  'olivier',
  'pascal', 'patrice', 'philippe', 'pierre',
  'quentin',
  'remi', 'renaud', 'romain',
  'sebastien', 'stephane', 'sylvain',
  'thierry',
  'yann', 'yves',

  // ══════════════════════════════════════════════════════════════
  // GERMAN / AUSTRIAN
  // ══════════════════════════════════════════════════════════════
  'anke', 'annett',
  'birgit',
  'claudia', 'cornelia',
  'dagmar', 'doris',
  'gabi', 'gertrud', 'gudrun',
  'hannelore', 'heidi', 'heike',
  'inga', 'inge',
  'jutta',
  'karin', 'katja',
  'marlene', 'meike', 'monika',
  'petra',
  'renate',
  'sabine', 'silke', 'sonja', 'susanne',
  'tanja',
  'ulrike', 'ursula', 'ute',
  'bernd', 'bernhard',
  'christoph', 'claus',
  'detlef', 'dieter', 'dietrich', 'dirk', 'dominik',
  'erich',
  'florian', 'friedhelm', 'friedrich', 'fritz',
  'gerhard', 'gerd', 'goetz', 'guenter',
  'hans', 'hartmut', 'heinz', 'helmut', 'herbert', 'holger', 'horst',
  'ingo',
  'jens', 'jochen', 'joerg', 'juergen',
  'karsten', 'klaus', 'konrad', 'kurt',
  'lothar', 'lutz',
  'manfred', 'matthias', 'markus',
  'norbert',
  'olaf', 'otto',
  'rainer', 'ralf', 'reinhard', 'roland', 'rolf', 'ruediger',
  'siegfried',
  'thorsten', 'torsten',
  'uwe', 'ulf',
  'volker',
  'walther', 'werner', 'wilfried', 'winfried', 'wolfgang',

  // ══════════════════════════════════════════════════════════════
  // TURKISH
  // ══════════════════════════════════════════════════════════════
  'aysegul', 'ayse', 'aylin', 'arzu',
  'bahar', 'buse',
  'canan',
  'derya', 'dilek',
  'ebru', 'elif', 'emine', 'esra',
  'fatma', 'filiz',
  'gamze', 'gonca', 'gulcan',
  'hatice',
  'leyla',
  'merve', 'melek',
  'nihan', 'nilufer', 'nur', 'nuray',
  'ozlem',
  'pinar',
  'seda', 'serap', 'sevgi', 'sibel', 'sinem',
  'yasemin',
  'zehra', 'zeynep',
  'ahmet', 'alper',
  'bahadir', 'baris', 'burak',
  'cem', 'cengiz',
  'emre', 'erdal', 'erdem', 'erhan',
  'fatih', 'ferhat', 'firat',
  'gokhan',
  'hakan', 'halil', 'huseyin',
  'ilhan', 'ismail',
  'kemal', 'kerem', 'koray',
  'mehmet', 'mert', 'murat', 'mustafa',
  'necdet', 'nihat',
  'okan', 'onur', 'orhan', 'osman', 'ozgur',
  'recep',
  'selim', 'serdar', 'serkan', 'sinan', 'suleyman',
  'taner', 'tolga', 'tuncay', 'turgut',
  'ugur',
  'volkan',
  'yasin', 'yilmaz', 'yunus', 'yusuf',

  // ══════════════════════════════════════════════════════════════
  // GREEK
  // ══════════════════════════════════════════════════════════════
  'androniki', 'athena',
  'despoina', 'dimitra',
  'eleftheria', 'elpida', 'evangelia',
  'ioanna', 'irini',
  'katerina', 'kyriaki',
  'maria', 'marina',
  'niki',
  'paraskevi',
  'sofia', 'stavroula',
  'vasiliki',
  'alexandros', 'anastasios', 'antonios',
  'charalampos', 'christos',
  'dimitrios', 'dimitris',
  'efstratios', 'elias',
  'georgios', 'giorgos',
  'ioannis',
  'konstantinos', 'kostas',
  'michalis',
  'nikos', 'nikolaos',
  'panagiotis', 'pavlos', 'petros',
  'sotirios', 'spyros', 'stavros',
  'thanasis', 'theodoros', 'thomas',
  'vasilis', 'vassilis',
  'yannis',

  // ══════════════════════════════════════════════════════════════
  // AFRICAN / CARIBBEAN / AFRICAN-BRITISH
  // ══════════════════════════════════════════════════════════════

  // ── West African (Nigerian, Ghanaian) ──
  'abimbola', 'adaeze', 'adenike', 'adewale', 'afolabi',
  'akosua', 'amara',
  'bola', 'bukola',
  'chiamaka', 'chidinma', 'chidi', 'chinelo', 'chinonso',
  'damilola',
  'ebele', 'emeka',
  'folake', 'funke', 'funmi',
  'ifeoma', 'ifeoluwa',
  'kemi', 'kofi', 'kwame', 'kwesi',
  'lateef',
  'ngozi', 'nkechi', 'nneka', 'nnamdi',
  'obinna', 'olajide', 'olamide', 'olanrewaju', 'olayinka',
  'olu', 'oluchi', 'oluwaseun', 'oluwatobiloba',
  'segun', 'sola', 'sulaimon',
  'temitope', 'tobi', 'tolulope', 'tunde',
  'uchechukwu', 'ugochukwu',
  'wale',
  'yewande', 'yemi',

  // ── East African (Somali, Ethiopian, Eritrean) ──
  'abdi', 'amina',
  'fadumo', 'fatuma', 'fathi',
  'habiba', 'hamdi',
  'idris', 'ismail',
  'khadija',
  'liban',
  'sahra', 'samatar',
  'yusra',
  'zeinab',

  // ── Caribbean ──
  'beverly', 'clive', 'delroy', 'desmond', 'errol',
  'leroy', 'marcia', 'neville', 'paulette', 'rudolph',
  'sonia', 'trevor', 'winston',

  // ══════════════════════════════════════════════════════════════
  // CHINESE (Common anglicized given names used in UK business)
  // ══════════════════════════════════════════════════════════════
  'bao',
  'chao', 'chen', 'cheng',
  'dandan',
  'fang', 'feng',
  'guang',
  'hao', 'hong', 'hua', 'hui',
  'jia', 'jian', 'jing', 'jun',
  'kai',
  'lei', 'ling', 'lixia',
  'mei', 'min', 'ming',
  'nan',
  'ping',
  'qian', 'qing',
  'rui',
  'shan', 'shu',
  'tao', 'ting',
  'wei', 'wen',
  'xia', 'xiao', 'xin', 'xiu', 'xiulan',
  'yan', 'yang', 'ying', 'yong', 'yuan', 'yue',
  'zhen', 'zhi',

  // ══════════════════════════════════════════════════════════════
  // KOREAN / JAPANESE / VIETNAMESE
  // ══════════════════════════════════════════════════════════════

  // ── Korean ──
  'eunji', 'hyejin', 'hyun', 'jieun', 'jiyeon',
  'minjung', 'minji', 'soyeon', 'suji', 'yejin', 'yuna',
  'dongwoo', 'jaehyun', 'jinwoo', 'minho', 'seunghyun',
  'sungjin', 'woojin', 'youngjae',

  // ── Japanese ──
  'akiko', 'ayumi', 'chihiro', 'haruka', 'keiko', 'kumiko',
  'maki', 'mayumi', 'megumi', 'mika', 'misaki', 'naomi',
  'sachiko', 'sakura', 'sayuri', 'yoko', 'yuki', 'yumi',
  'akira', 'daichi', 'daisuke', 'hiro', 'hiroshi', 'kazuki',
  'kenji', 'kenta', 'makoto', 'masashi', 'ryota', 'satoshi',
  'shingo', 'takashi', 'takeshi', 'tatsuya', 'yusuke',

  // ── Vietnamese ──
  'anh', 'binh', 'duc', 'hanh', 'hien', 'hoang', 'huy',
  'khanh', 'lan', 'linh', 'minh', 'ngan', 'nhat',
  'phuong', 'quang', 'tam', 'thi', 'thuy', 'tien', 'trang',
  'trung', 'tuan', 'tuyen', 'van', 'viet',

  // ══════════════════════════════════════════════════════════════
  // ADDITIONAL UK NAMES (less common but found in business)
  // ══════════════════════════════════════════════════════════════
  'alistair', 'anabel', 'barnaby', 'barrie', 'basil',
  'bertie', 'beverley', 'bryn',
  'cedric', 'ceri', 'clifford', 'clint', 'crispin',
  'daphne', 'deirdre', 'delia', 'della',
  'edmund', 'edna', 'elsie', 'enid', 'ernest',
  'fleur', 'geraldine', 'gilbert', 'gladys',
  'godfrey', 'grahame', 'greta',
  'hector', 'hermione', 'hester', 'humphrey',
  'ingram', 'iona',
  'jacinta', 'jarvis', 'jeanette', 'jocelyn', 'jolene',
  'josephina',
  'keiran', 'kingsley',
  'lavinia', 'leopold', 'lionel', 'lucinda',
  'mabel', 'madeleine', 'marjorie', 'mavis', 'meryl',
  'mervyn', 'millicent', 'montague', 'muriel', 'myrtle',
  'neville', 'norma',
  'ottilie',
  'percival', 'piers', 'prudence',
  'quentin',
  'reginald', 'roland', 'rosamund', 'rowena', 'ruben',
  'sabrina', 'selwyn', 'sheridan', 'sybil',
  'tarquin', 'theodora', 'theresa', 'thomasina', 'tobias',
  'tristram',
  'venetia',
  'wilfred', 'winifred',
];

// Pre-process: deduplicate and sort by length descending (longest match first)
const NAMES_SET = new Set(COMMON_FIRST_NAMES.map(n => n.toLowerCase()));
const NAMES_SORTED_BY_LENGTH = [...NAMES_SET].sort((a, b) => b.length - a.length);

module.exports = {
  COMMON_FIRST_NAMES: NAMES_SORTED_BY_LENGTH,
  COMMON_FIRST_NAMES_SET: NAMES_SET
};
