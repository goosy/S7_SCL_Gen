import { context } from './util.js';

const template = `no,eventtag,location,event,PV1
{{for no, alarm in list}}{{no+1}},{{alarm.tagname}},{{alarm.location}},{{alarm.event}},{{alarm.PV1}}
{{endfor}}`;

export function gen_alarms(cpu_list) {
    return cpu_list.map(
        cpu => ({
            cpu_name: cpu.name,
            feature: '',
            platform: cpu.platform,
            distance: `${cpu.output_dir}/alarms.csv`,
            output_dir: context.work_path,
            tags: { list: cpu.alarms_list },
            template,
        })
    );
}