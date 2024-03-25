const template = `no,eventtag,location,event,PV1
{{for no, alarm in list}}{{no+1}},{{alarm.tagname}},{{alarm.location}},{{alarm.event}},{{alarm.PV1}}
{{endfor}}`;

export function gen_alarms(cpu_list) {
    return cpu_list.map(
        cpu => ({
            cpu_name: cpu.name,
            feature: '',
            platform: cpu.platform,
            dst: `${cpu.output_dir}/alarms.csv`,
            tags: { list: cpu.alarms_list },
            template,
        })
    );
}