/**
 * Common First Names Dictionary
 *
 * Used for dictionary-based splitting of concatenated email usernames
 * e.g., "kategymer" → match "kate" → split → "Kate Gymer"
 *
 * ~600 common international first names, sorted by length descending
 * for longest-match-first extraction.
 *
 * Covers: UK/English, Welsh, Scottish, Irish, Spanish, Portuguese,
 * Catalan, Basque, Galician, Scandinavian (Danish/Swedish/Norwegian),
 * Indian (North/South/Bengali/Marathi), Pakistani, NZ/Pacific,
 * African American, and more.
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
];

// Pre-process: deduplicate and sort by length descending (longest match first)
const NAMES_SET = new Set(COMMON_FIRST_NAMES.map(n => n.toLowerCase()));
const NAMES_SORTED_BY_LENGTH = [...NAMES_SET].sort((a, b) => b.length - a.length);

module.exports = {
  COMMON_FIRST_NAMES: NAMES_SORTED_BY_LENGTH,
  COMMON_FIRST_NAMES_SET: NAMES_SET
};
