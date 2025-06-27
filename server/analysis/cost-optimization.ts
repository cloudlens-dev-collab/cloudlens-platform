import { storage } from "../storage";

export interface OptimizationAnalysis {
  ebsOptimization: {
    unattachedVolumes: { count: number; monthlyCost: number };
    oversizedVolumes: { count: number; potentialSavings: number };
  };
  ec2Optimization: {
    stoppedInstances: { count: number; monthlyCost: number; potentialSavings: number };
  };
  networkingOptimization: {
    loadBalancers: { count: number; consolidationOpportunity: number };
    elasticIPs: { potentialSavings: number };
  };
  totalPotentialSavings: number;
}

export async function analyzeOptimizationOpportunities(accountId: number): Promise<OptimizationAnalysis> {
  const resources = await storage.getResourcesByAccount(accountId);
  const costs = await storage.getCostsByAccount(accountId);
  
  // EBS Analysis
  const unattachedVolumes = resources.filter(r => r.type === 'ebs-volume' && r.status === 'available');
  const unattachedVolumesCost = unattachedVolumes.reduce((sum, vol) => sum + parseFloat(vol.monthlyCost || "0"), 0);
  
  // EC2 Analysis
  const stoppedInstances = resources.filter(r => r.type === 'ec2-instance' && r.status === 'stopped');
  const stoppedInstancesCost = stoppedInstances.reduce((sum, inst) => sum + parseFloat(inst.monthlyCost || "0"), 0);
  
  // Networking Analysis
  const loadBalancers = resources.filter(r => r.type === 'load-balancer');
  
  // EC2-Other service analysis from actual cost data
  const ec2OtherCosts = costs.filter(cost => cost.service === 'EC2 - Other');
  const ec2OtherTotal = ec2OtherCosts.reduce((sum, cost) => sum + parseFloat(cost.amount), 0);
  
  // Conservative optimization estimates based on industry standards
  const ebsOversizedSavings = (resources.filter(r => r.type === 'ebs-volume').length * 50) * 0.1; // 10% of volumes oversized
  const stoppedInstanceSavings = stoppedInstancesCost * 0.3; // 30% savings from cleanup
  const ec2OtherOptimization = ec2OtherTotal * 0.15; // 15% through rightsizing
  const loadBalancerConsolidation = loadBalancers.length > 10 ? 200 : 0; // Conservative LB savings
  
  return {
    ebsOptimization: {
      unattachedVolumes: { count: unattachedVolumes.length, monthlyCost: unattachedVolumesCost },
      oversizedVolumes: { count: Math.floor(resources.filter(r => r.type === 'ebs-volume').length * 0.1), potentialSavings: ebsOversizedSavings },
    },
    ec2Optimization: {
      stoppedInstances: { count: stoppedInstances.length, monthlyCost: stoppedInstancesCost, potentialSavings: stoppedInstanceSavings },
    },
    networkingOptimization: {
      loadBalancers: { count: loadBalancers.length, consolidationOpportunity: loadBalancerConsolidation },
      elasticIPs: { potentialSavings: 50 }, // Typical unused EIP savings
    },
    totalPotentialSavings: unattachedVolumesCost + stoppedInstanceSavings + ec2OtherOptimization + loadBalancerConsolidation + 50,
  };
}