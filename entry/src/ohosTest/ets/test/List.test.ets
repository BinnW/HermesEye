import abilityTest from './Ability.test';
import flowTest from './Flow.test';
import projectFlowTest from './ProjectFlow.test';
import readingFlowTest from './ReadingFlow.test';

export default function testsuite() {
  abilityTest();
  flowTest();
  projectFlowTest();
  readingFlowTest();
}
