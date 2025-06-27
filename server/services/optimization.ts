import type { Resource, Cost } from "@shared/schema";

export interface OptimizationRecommendation {
  id: string;
  title: string;
  description: string;
  potentialSavings: number;
  impact: "High" | "Medium" | "Low";
  type: "compute" | "storage" | "network" | "database";
  resources: Array<{
    resourceId: string;
    name: string;
    monthlyCost: number;
  }>;
}

export class OptimizationService {
  analyzeResources(resources: Resource[], costs: Cost[]): OptimizationRecommendation[] {
    const recommendations: OptimizationRecommendation[] = [];

    // 1. Unattached EBS Volumes
    const unattachedVolumes = resources.filter(r => 
      r.type === "ebs-volume" && r.status === "available"
    );
    
    if (unattachedVolumes.length > 0) {
      const totalSavings = unattachedVolumes.reduce((sum, vol) => 
        sum + parseFloat(vol.monthlyCost || "0"), 0
      );
      
      recommendations.push({
        id: "unattached-ebs-volumes",
        title: "Delete unattached EBS volumes",
        description: `${unattachedVolumes.length} EBS volumes not attached to any instance`,
        potentialSavings: totalSavings,
        impact: totalSavings > 100 ? "High" : totalSavings > 50 ? "Medium" : "Low",
        type: "storage",
        resources: unattachedVolumes.map(vol => ({
          resourceId: vol.resourceId,
          name: vol.name,
          monthlyCost: parseFloat(vol.monthlyCost || "0")
        }))
      });
    }

    // 2. Stopped EC2 Instances (potential right-sizing)
    const stoppedInstances = resources.filter(r => 
      r.type === "ec2-instance" && r.status === "stopped"
    );
    
    if (stoppedInstances.length > 0) {
      const estimatedSavings = stoppedInstances.reduce((sum, instance) => 
        sum + parseFloat(instance.monthlyCost || "0"), 0
      );
      
      if (estimatedSavings > 0) {
        recommendations.push({
          id: "stopped-instances",
          title: "Review stopped EC2 instances",
          description: `${stoppedInstances.length} instances have been stopped - consider terminating unused instances`,
          potentialSavings: estimatedSavings * 0.3, // Conservative 30% savings estimate
          impact: "Medium",
          type: "compute",
          resources: stoppedInstances.map(instance => ({
            resourceId: instance.resourceId,
            name: instance.name,
            monthlyCost: parseFloat(instance.monthlyCost || "0")
          }))
        });
      }
    }

    // 3. Oversized EBS Volumes (>1TB)
    const largeVolumes = resources.filter(r => 
      r.type === "ebs-volume" && 
      r.metadata?.size && 
      parseInt(r.metadata.size) > 1000 // >1TB
    );

    if (largeVolumes.length > 0) {
      const estimatedSavings = largeVolumes.reduce((sum, vol) => 
        sum + parseFloat(vol.monthlyCost || "0") * 0.2, 0 // 20% potential savings
      );
      
      recommendations.push({
        id: "oversized-volumes",
        title: "Optimize large EBS volumes",
        description: `${largeVolumes.length} volumes >1TB may be oversized for their usage`,
        potentialSavings: estimatedSavings,
        impact: estimatedSavings > 200 ? "High" : "Medium",
        type: "storage",
        resources: largeVolumes.map(vol => ({
          resourceId: vol.resourceId,
          name: vol.name,
          monthlyCost: parseFloat(vol.monthlyCost || "0")
        }))
      });
    }

    // 4. High-cost services analysis
    const serviceCosts = new Map<string, number>();
    costs.forEach(cost => {
      const current = serviceCosts.get(cost.service) || 0;
      serviceCosts.set(cost.service, current + parseFloat(cost.amount));
    });

    const expensiveServices = Array.from(serviceCosts.entries())
      .filter(([service, amount]) => amount > 1000)
      .sort((a, b) => b[1] - a[1]);

    if (expensiveServices.length > 0) {
      const [topService, topAmount] = expensiveServices[0];
      recommendations.push({
        id: "high-cost-service",
        title: `Optimize ${topService} usage`,
        description: `${topService} represents $${topAmount.toFixed(2)} of monthly spend - review for optimization opportunities`,
        potentialSavings: topAmount * 0.15, // 15% potential optimization
        impact: "High",
        type: "compute",
        resources: []
      });
    }

    return recommendations.sort((a, b) => b.potentialSavings - a.potentialSavings);
  }

  getTotalPotentialSavings(recommendations: OptimizationRecommendation[]): number {
    return recommendations.reduce((sum, rec) => sum + rec.potentialSavings, 0);
  }
}

export const optimizationService = new OptimizationService();