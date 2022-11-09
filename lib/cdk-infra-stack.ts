import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2'

export class CdkInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'test-vpc', {
      subnetConfiguration: [
        {
          cidrMask: 24,
          name:'public',
          subnetType: ec2.SubnetType.PUBLIC
        },
        {
          cidrMask: 24,
          name:'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
        }
      ],
      maxAzs: 1
    });
   
  }
}
