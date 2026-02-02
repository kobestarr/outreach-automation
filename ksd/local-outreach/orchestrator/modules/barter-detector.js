const barterCategories = {
  cafe: { value: "high", offering: "coffee/food credits", discount: 50 },
  restaurant: { value: "high", offering: "food credits", discount: 100 },
  salon: { value: "high", offering: "haircuts/treatments", discount: 100 },
  gym: { value: "high", offering: "membership", discount: 100 },
  dentist: { value: "high", offering: "dental work", discount: 200 }
};

function detectBarterOpportunity(business) {
  const category = (business.category || "").toLowerCase();
  const barterInfo = Object.entries(barterCategories).find(([cat]) => category.includes(cat));
  if (!barterInfo) return { eligible: false, value: "low" };
  const [barterCategory, info] = barterInfo;
  return {
    eligible: true,
    category: barterCategory,
    value: info.value,
    offering: info.offering,
    discount: info.discount
  };
}

module.exports = { detectBarterOpportunity };
