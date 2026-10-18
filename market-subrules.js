// Sub-splits applied only inside a primary market (first match wins); parent label -> [[sub label, regex]]
const P = {
 'junior gold and silver mining companies': [],
 'lithium and critical minerals exploration companies': [['uranium exploration companies', /\buranium\b/i], ['diamond mining companies', /\bdiamond/i], ['rare earth and graphite producers', /\b(rare earth|graphite|graphene)\b/i], ['lithium exploration companies', /\blithium\b/i]],
 'renewable energy developers': [['EV charging and electric mobility companies', /\b(EV charg|electric (boat|vehicle|motor)|mobility)/i], ['carbon capture and decarbonization providers', /\b(carbon|decarboni|emission)/i], ['solar energy developers', /\bsolar\b/i]],
 'space and satellite technology companies': [['space propulsion and launch companies', /\b(propulsion|launch|rocket|hypersonic)/i]],
 'AI cybersecurity platforms': [['AI agent security platforms', /\b(AI|agent|LLM)/i], ['anti-fraud and identity verification software', /\b(fraud|identity|biometric|KYC|authentication|phishing|brand protection)/i], ['cloud security and compliance automation tools', /\b(cloud|SOC ?2|compliance|XDR|endpoint|patching)/i]],
 'B2B payments and fintech platforms': [['payroll and employee benefits platforms', /\b(payroll|benefit|wage|employer)/i], ['billing and revenue management software', /\b(billing|revenue|invoice|ERP)/i], ['accounting and tax software', /\b(accounting|tax|bookkeep)/i]],
 'AI healthcare administration software': [['revenue cycle and claims processing software', /\b(revenue cycle|claims|billing|reimbursement)/i], ['healthcare staffing platforms', /\b(staff|workforce|nurse)/i], ['telehealth and virtual care platforms', /\b(telehealth|virtual|remote)/i], ['digital health for chronic conditions', /\b(chronic|diabet|cardio|heart|GI|kidney|maternal|elderly|senior)/i], ['AI medical front office and scribe software', /\b(front office|scribe|clinic|dental|practice|call|intake)/i]],
 'medical device companies': [['surgical robotics and orthopedic device makers', /\b(surgical|orthop|endoscop|catheter|stroke|brain)/i]],
 'clinical stage biotech and drug developers': [['oncology drug developers', /\b(oncolog|cancer|tumor|immuno)/i], ['RNA and protein therapeutics developers', /\b(RNA|protein|antibod|degrad|peptide|multiomics|enzyme)/i]],
 'AI sales and marketing automation platforms': [['AI sales coaching and CRM tools', /\b(sales|CRM|lead)/i], ['social media and creator marketing platforms', /\b(social|creator|influencer|community|UGC|brand engagement)/i]],
 'robotics and industrial automation companies': [['warehouse and industrial robotics companies', /\b(warehouse|robot|autonomous)/i], ['3D printing and advanced manufacturing companies', /\b(3D print|additive|welding|manufactur|materials|membrane)/i]],
 'AI data analytics and observability platforms': [['AI search and retrieval infrastructure providers', /\b(search|retrieval|knowledge|context|semantic|LLM)/i]],
};
module.exports = P;
